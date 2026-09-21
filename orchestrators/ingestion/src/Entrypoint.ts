import { bindCatalog, Catalog } from '#Catalog';
import { instanceId } from '#InstanceId';
import { bindMatch, Match } from '#Match';
import { makeReviews, Reviews } from '#Reviews';
import { OrchestratorRpcs } from '#rpcs';
import IngestMatchWorkflow from '#Workflow';
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

// Pending reviews, keyed by workflow instance. Resources live on the edge in
// every environment, dev included; only the code runs locally.
export const IngestionReviews = Cloudflare.KV.Namespace('IngestionReviews').pipe(Alchemy.remote());

// The class is only an identifier: the gateway imports it to bind the service
// without evaluating this worker's init inside its own runtime, where the
// workflow binding below would not exist. The runtime lives in the default
// export, which only the stack provides.
export class IngestionOrchestrator extends Cloudflare.RpcWorker<IngestionOrchestrator>()(
  'IngestionOrchestrator',
  { schema: OrchestratorRpcs },
) {}

export default IngestionOrchestrator.make(
  { main: import.meta.url, observability: { enabled: true } },
  Effect.gen(function* () {
    // INIT: the service bindings to the catalog and the match service for the
    // matcher and the writer, and the review store; the workflow gets them
    // all as services.
    const catalog = yield* bindCatalog;
    const match = yield* bindMatch;
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(IngestionReviews);

    const reviews = makeReviews(kv);
    const ingestMatch = yield* IngestMatchWorkflow.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Catalog, catalog),
          Layer.succeed(Match, match),
          Layer.succeed(Reviews, reviews),
        ),
      ),
    );

    const handlers = OrchestratorRpcs.toLayer({
      ingestMatch: ({ source, html }) =>
        Effect.gen(function* () {
          const id = yield* instanceId(source, html);
          // Alchemy's handle has no failure channel, so a reused id surfaces as
          // a defect. The page is then already an instance, and submitting it
          // again means "ingest this page now": whatever the instance was
          // doing, waiting on a review or finished long ago, it starts over
          // against the catalog as it is. A defect for any other reason has no
          // instance behind it and stays a defect.
          yield* ingestMatch.create({ id, params: { source, html } }).pipe(
            Effect.catchDefect((defect) =>
              ingestMatch.get(id).pipe(
                Effect.catchDefect(() => Effect.die(defect)),
                Effect.flatMap((instance) => instance.restart()),
              ),
            ),
          );
          return { workflowId: id };
        }),
      getIngestion: ({ workflowId }) =>
        Effect.all({
          status: ingestMatch.get(workflowId).pipe(Effect.flatMap((instance) => instance.status())),
          review: reviews.pending(workflowId),
        }).pipe(
          Effect.map(({ status, review }) => ({
            status: status.status,
            output: status.output ?? null,
            error: status.error ?? null,
            review,
          })),
        ),
      reviewIngestion: ({ workflowId, decisions, approve }) =>
        ingestMatch.get(workflowId).pipe(
          Effect.flatMap((instance) =>
            instance.sendEvent({ type: 'review', payload: { decisions, approve } }),
          ),
          Effect.map(() => ({ workflowId })),
        ),
    });
    // NDJSON, not JSON: `Cloudflare.RpcWorker.bind`'s client uses
    // `RpcSerialization.layerNdjson`, so the server must match it.
    // Alchemy's two-phase worker: init resolves bindings once and hands back the
    // per-request effect, so the nested Effect is the contract, not an accident.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return RpcServer.toHttpEffect(OrchestratorRpcs).pipe(
      Effect.provide(Layer.mergeAll(handlers, RpcSerialization.layerNdjson)),
    );
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
);
