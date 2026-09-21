import { PendingReview } from '@skoreon/api-gateway-contract/Matches';
import type * as Cloudflare from 'alchemy/Cloudflare';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

// What a workflow is waiting on, kept where the status endpoint can read it.
// A workflow instance exposes no intermediate state, so the pending review is
// written beside it and removed once the workflow moves on.
//
// `RuntimeContext` is Alchemy's per-invocation ambient service, passed through
// on purpose the way a request would be; it is not an implementation detail
// that a layer could resolve up front.
// @effect-diagnostics-next-line leakingRequirements:off
export class Reviews extends Context.Service<
  Reviews,
  {
    readonly request: (
      workflowId: string,
      review: PendingReview,
    ) => Effect.Effect<void, never, RuntimeContext>;
    readonly pending: (
      workflowId: string,
    ) => Effect.Effect<PendingReview | null, never, RuntimeContext>;
    readonly close: (workflowId: string) => Effect.Effect<void, never, RuntimeContext>;
  }
>()('Ingestion.Reviews') {}

const encode = Schema.encodeEffect(Schema.fromJsonString(PendingReview));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PendingReview));

// A workflow waits at most a week for a review, so the record need not outlive it.
const retentionSeconds = 7 * 24 * 60 * 60;

export const makeReviews = (
  kv: Cloudflare.KV.ReadWriteNamespaceClient,
): typeof Reviews.Service => ({
  request: (workflowId, review) =>
    encode(review).pipe(
      Effect.flatMap((json) => kv.put(workflowId, json, { expirationTtl: retentionSeconds })),
      Effect.orDie,
    ),
  pending: (workflowId) =>
    kv.get(workflowId).pipe(
      Effect.flatMap((json: unknown) => (json === null ? Effect.succeed(null) : decode(json))),
      Effect.orDie,
    ),
  close: (workflowId) => kv.delete(workflowId).pipe(Effect.orDie),
});
