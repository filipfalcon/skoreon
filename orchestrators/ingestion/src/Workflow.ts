import { Catalog } from '#Catalog';
import { Match } from '#Match';
import { applicableDecisions, learnFromDecisions, matchWithCatalog } from '#Matcher';
import { NonRetryableError } from '#NonRetryableError';
import { normalizeReport } from '#Normalizer';
import { parseMatchPage } from '#Parser';
import { catalogRecords, type Ids, matchRecords, recordLabels } from '#Records';
import { Reviews } from '#Reviews';
import type { IngestMatchInput } from '#rpcs';
import { type ReviewDecision, ReviewReply } from '@skoreon/api-gateway-contract/Matches';
import { uuidV7 } from '@skoreon/catalog-service/Ids';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const decodeReply = Schema.decodeUnknownEffect(ReviewReply);

// A reviewer gets this many replies to settle and approve a report before it
// is given up on. A page that resolves by itself still takes one, for the
// approval.
const reviewRounds = 5;

const briefly = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '1 minute',
} as const;
const once = { retries: { limit: 0, delay: '1 second' }, timeout: '1 minute' } as const;

// Ingests one scraped match page. Each stage is a durable step, so a failure
// resumes from the last completed one instead of paying for the model again.
export default class IngestMatchWorkflow extends Cloudflare.Workflow<IngestMatchWorkflow>()(
  'IngestMatch',
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    const match = yield* Match;
    const reviews = yield* Reviews;

    return Effect.fn(function* (input: IngestMatchInput) {
      const { instanceId } = yield* Cloudflare.WorkflowEvent;

      // The page read by its markup. Deterministic, so a page that does not
      // read the same on a second attempt does not exist; whatever does not
      // read is said, and the run ends.
      const report = yield* Cloudflare.Workflows.task(
        'parse',
        parseMatchPage(input.source, input.html).pipe(
          Effect.catchTags({
            NotAMatchPageError: (error) => Effect.die(new NonRetryableError(error.message)),
            MatchReportParseError: (error) =>
              Effect.die(new NonRetryableError(error.message, { cause: error })),
          }),
        ),
        once,
      );

      // Pure, but a step of its own: the keys are what the reviewer sees and
      // what the match was made on, so they are kept with the run.
      const normalized = yield* Cloudflare.Workflows.task(
        'normalize',
        Effect.sync(() => normalizeReport(report)),
        once,
      );

      const resolve = (name: string, decisions: ReadonlyArray<ReviewDecision>) =>
        Cloudflare.Workflows.task(
          name,
          matchWithCatalog(catalog, normalized, decisions).pipe(Effect.orDie),
          briefly,
        );

      let decisions: ReadonlyArray<ReviewDecision> = [];
      let matched = yield* resolve('match', decisions);

      // Whether the workflow moves on or gives up, nothing is pending any more.
      const closeReview = Cloudflare.Workflows.task(
        'review-close',
        reviews.close(instanceId),
        briefly,
      );

      // Whatever the catalog could not settle goes to a reviewer, and so does
      // the settled picture, for approval. The workflow sleeps until the reply
      // arrives, learns the spellings it teaches, and matches again with the
      // decisions applied, until nothing is left and the reviewer has approved
      // or has had enough rounds.
      for (let round = 1; ; round++) {
        if (round > reviewRounds) {
          yield* closeReview;
          return yield* Effect.die(
            new NonRetryableError(
              matched.unmatched.length > 0
                ? `Still unmatched after ${reviewRounds} review rounds: ${matched.unmatched.map((item) => `${item.kind.toLowerCase()} "${item.printed}"`).join(', ')}`
                : `Not approved after ${reviewRounds} review rounds`,
            ),
          );
        }

        const pending = {
          unmatched: matched.unmatched,
          creations: decisions.flatMap((decision) => ('create' in decision ? [decision] : [])),
        };
        yield* Cloudflare.Workflows.task(
          `review-${round}-request`,
          reviews.request(instanceId, pending),
          briefly,
        );

        const event = yield* Cloudflare.Workflows.waitForEvent<unknown>(`review-${round}`, {
          type: 'review',
          timeout: '7 days',
        });
        // A reply that does not decode is a slip, not a verdict: it is
        // logged, counts as a round, and the review is asked for again.
        // Only decisions that answer what was asked count: a stray one would
        // otherwise be learned as an alias without ever matching anything.
        const reply = yield* decodeReply(event.payload).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(`The review reply could not be read: ${error.message}`),
          ),
          Effect.orElseSucceed(() => ({ decisions: [], approve: false })),
        );
        const answered = applicableDecisions(pending.unmatched, reply.decisions);
        decisions = [...decisions, ...answered];

        yield* Cloudflare.Workflows.task(
          `review-${round}-learn`,
          learnFromDecisions(catalog, normalized, answered).pipe(Effect.orDie),
          briefly,
        );

        matched = yield* resolve(`match-${round}`, decisions);
        if (matched.unmatched.length === 0 && reply.approve) break;
      }

      yield* closeReview;

      // Every record gets its identifier before anything is written, so a
      // write that has to be retried writes the same records, not new ones.
      const ids = yield* Cloudflare.Workflows.task(
        'allocate-ids',
        Effect.forEach(recordLabels(report, normalized, matched), (label) =>
          uuidV7.pipe(Effect.map((id) => [label, id] as const)),
        ).pipe(Effect.map((entries): Ids => Object.fromEntries(entries))),
        once,
      );

      // The catalog first: the match refers to what it adds.
      yield* Cloudflare.Workflows.task(
        'write-catalog',
        Effect.sync(() => catalogRecords(normalized, matched, ids)).pipe(
          Effect.flatMap((records) => catalog.createIngestionRecords(records)),
          Effect.orDie,
        ),
        briefly,
      );

      const written = yield* Cloudflare.Workflows.task(
        'write-match',
        Effect.sync(() => matchRecords(report, normalized, matched, ids)).pipe(
          Effect.flatMap((records) => match.recordMatch(records)),
          Effect.orDie,
        ),
        briefly,
      );
      // Another page already recorded this match. Replacing it is not this
      // workflow's to decide.
      if (written.outcome === 'NUMBER_TAKEN') {
        return yield* Effect.die(
          new NonRetryableError(
            `Match ${report.source.matchNumber} is already recorded as ${written.matchId}`,
          ),
        );
      }

      return { report, normalized, matched, matchId: written.matchId };
    });
  }),
) {}
