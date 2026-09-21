import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import ApiGateway from './orchestrators/api-gateway/src/Entrypoint.ts';
import IngestionOrchestratorLive, {
  IngestionOrchestrator,
} from './orchestrators/ingestion/src/Entrypoint.ts';
import CatalogServiceLive, { CatalogService } from './services/catalog/src/Entrypoint.ts';
import MatchServiceLive, { MatchService } from './services/match/src/Entrypoint.ts';

export default Alchemy.Stack(
  'Skoreon',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  // The workers are typed with an open requirements channel by Alchemy itself;
  // the stack cannot narrow what it only yields.
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off
  Effect.gen(function* () {
    const catalogService = yield* CatalogService;
    const matchService = yield* MatchService;
    const ingestionOrchestrator = yield* IngestionOrchestrator;
    const apiGateway = yield* ApiGateway;

    return {
      catalogService: catalogService.url,
      matchService: matchService.url,
      ingestionOrchestrator: ingestionOrchestrator.url,
      apiGatewayUrl: apiGateway.url,
    };
  }).pipe(
    Effect.provide(Layer.mergeAll(CatalogServiceLive, MatchServiceLive, IngestionOrchestratorLive)),
  ),
);
