import { Source } from '#Enums';
import { MatchReport } from '#MatchReport';
import { Matched } from '#Matcher';
import { NormalizedReport } from '#Normalizer';
import { PendingReview, ReviewReply } from '@skoreon/api-gateway-contract/Matches';
import * as Schema from 'effect/Schema';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';

// The page as the client's browser rendered it. The workflow reduces it to
// text itself, so what was submitted is kept whole with the run.
export const IngestMatchInput = Schema.Struct({
  source: Source,
  html: Schema.NonEmptyString,
});
export type IngestMatchInput = typeof IngestMatchInput.Type;

export const IngestMatchOutput = Schema.Struct({
  workflowId: Schema.String,
});
export type IngestMatchOutput = typeof IngestMatchOutput.Type;

// What the workflow ends with: the report read off the page, the keys it was
// matched by, where those keys landed in the catalog, and the match written.
export const IngestMatchResult = Schema.Struct({
  report: MatchReport,
  normalized: NormalizedReport,
  matched: Matched,
  matchId: Schema.String,
});
export type IngestMatchResult = typeof IngestMatchResult.Type;

// The instance status as Cloudflare reports it: queued, running, waiting,
// paused, complete, errored or terminated. The output is present once the
// workflow completed, the error once it failed.
export const IngestionStatus = Schema.Struct({
  status: Schema.String,
  output: Schema.NullOr(IngestMatchResult),
  error: Schema.NullOr(Schema.Struct({ name: Schema.String, message: Schema.String })),
  review: Schema.NullOr(PendingReview),
});
export type IngestionStatus = typeof IngestionStatus.Type;

const ingestMatch = Rpc.make('ingestMatch', {
  payload: IngestMatchInput.fields,
  success: IngestMatchOutput,
});

const getIngestion = Rpc.make('getIngestion', {
  payload: { workflowId: Schema.String },
  success: IngestionStatus,
});

const reviewIngestion = Rpc.make('reviewIngestion', {
  payload: { workflowId: Schema.String, ...ReviewReply.fields },
  success: IngestMatchOutput,
});

export class OrchestratorRpcs extends RpcGroup.make(ingestMatch, getIngestion, reviewIngestion) {}
