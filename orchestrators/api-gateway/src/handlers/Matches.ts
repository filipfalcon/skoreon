import type { IngestionClient } from '#Ingestion';
import { Contract } from '@skoreon/api-gateway-contract/Contract';
import * as Effect from 'effect/Effect';
import * as HttpApiBuilder from 'effect/unstable/httpapi/HttpApiBuilder';

export const MatchesHandlers = (ingestion: IngestionClient) =>
  HttpApiBuilder.group(Contract, 'Matches', (handlers) =>
    handlers
      .handle('create', ({ query, payload }) =>
        ingestion.ingestMatch({ source: query.source, html: payload }).pipe(Effect.orDie),
      )
      .handle('ingestion', ({ params }) =>
        ingestion.getIngestion({ workflowId: params.workflowId }).pipe(Effect.orDie),
      )
      .handle('review', ({ params, payload }) =>
        ingestion
          .reviewIngestion({
            workflowId: params.workflowId,
            decisions: payload.decisions,
            approve: payload.approve,
          })
          .pipe(Effect.orDie),
      ),
  );
