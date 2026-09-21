import { MatchService } from '@skoreon/match-service/Entrypoint';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Context from 'effect/Context';
import type * as Effect from 'effect/Effect';

export const bindMatch = Cloudflare.RpcWorker.bind(MatchService);

export type MatchClient = Effect.Success<typeof bindMatch>;

// The match service as seen from inside the workflow: bound once at worker
// init and handed in as a service, the same way the catalog is.
export class Match extends Context.Service<Match, MatchClient>()('Ingestion.Match') {}
