import { CatalogService } from '@skoreon/catalog-service/Entrypoint';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Context from 'effect/Context';
import type * as Effect from 'effect/Effect';

export const bindCatalog = Cloudflare.RpcWorker.bind(CatalogService);

export type CatalogClient = Effect.Success<typeof bindCatalog>;

// The catalog as seen from inside the workflow: bound once at worker init and
// handed in as a service, the same way the parser is.
export class Catalog extends Context.Service<Catalog, CatalogClient>()('Ingestion.Catalog') {}
