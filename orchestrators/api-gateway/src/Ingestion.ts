import { IngestionOrchestrator } from '@skoreon/ingestion-orchestrator/Entrypoint';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';

export const bindIngestion = Cloudflare.RpcWorker.bind(IngestionOrchestrator);

export type IngestionClient = Effect.Success<typeof bindIngestion>;
