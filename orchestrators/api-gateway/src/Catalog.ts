import { CatalogService } from '@skoreon/catalog-service/Entrypoint';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';

export const bindCatalog = Cloudflare.RpcWorker.bind(CatalogService);

export type CatalogClient = Effect.Success<typeof bindCatalog>;
