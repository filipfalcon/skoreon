import { MatchDatabase } from '#Database';
import { ServiceRpcs } from '#rpcs';
import { cards } from '#schema/Cards';
import { crewAssignments } from '#schema/CrewAssignments';
import { goals } from '#schema/Goals';
import { lineupEntries } from '#schema/LineupEntries';
import { lineups } from '#schema/Lineups';
import { matches } from '#schema/Matches';
import { relations } from '#schema/Relations';
import { substitutions } from '#schema/Substitutions';
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { drizzle } from 'drizzle-orm/d1';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

// The class is only an identifier, so the ingestion worker can bind to this
// service without evaluating its runtime in its own. The runtime lives in the
// default export, which only the stack provides.
export class MatchService extends Cloudflare.RpcWorker<MatchService>()('MatchService', {
  schema: ServiceRpcs,
}) {}

export default MatchService.make(
  { main: import.meta.url },
  Effect.gen(function* () {
    // Resources live on the edge in every environment, dev included; only the
    // code runs locally. The database is therefore never emulated.
    const database = yield* Cloudflare.D1.Database('MatchD1Database', {
      migrations: { dir: './services/match/migrations', table: 'drizzle_migrations' },
    }).pipe(Alchemy.remote());
    const connection = yield* Cloudflare.D1.QueryDatabase(database);
    const db = drizzle(yield* connection.raw, { relations });

    const handlers = ServiceRpcs.toLayer({
      greet: ({ name }) => Effect.succeed(`Hello ${name}`),
      recordMatch: (records) =>
        Effect.gen(function* () {
          const { match } = records;
          // The caller's identifier makes a repeated write recognizable; the
          // number makes a match recorded from another page recognizable.
          const recorded = yield* Effect.promise(() =>
            db.query.matches.findFirst({ columns: { id: true }, where: { id: match.id } }),
          );
          if (recorded !== undefined) {
            return { outcome: 'ALREADY_RECORDED' as const, matchId: recorded.id };
          }
          const { number } = match;
          if (number !== null) {
            const taken = yield* Effect.promise(() =>
              db.query.matches.findFirst({
                columns: { id: true },
                where: { number, deletedAt: { isNull: true } },
              }),
            );
            if (taken !== undefined) {
              return { outcome: 'NUMBER_TAKEN' as const, matchId: taken.id };
            }
          }

          const at = DateTime.toDate(yield* DateTime.now);
          const audit = {
            createdAt: at,
            createdBy: 'INGESTION',
            updatedAt: at,
            updatedBy: 'INGESTION',
          };
          const matchId = match.id;
          // One batch, so the match is either whole or absent.
          yield* Effect.promise(() =>
            db.batch([
              db.insert(matches).values({
                ...audit,
                ...match,
                kickoffAt: DateTime.toDate(DateTime.makeUnsafe(match.kickoffAt)),
              }),
              ...records.lineups.map((lineup) =>
                db.insert(lineups).values({ ...audit, matchId, ...lineup }),
              ),
              ...records.lineupEntries.map((entry) =>
                db.insert(lineupEntries).values({ ...audit, ...entry }),
              ),
              ...records.goals.map((goal) =>
                db.insert(goals).values({ ...audit, matchId, ...goal }),
              ),
              ...records.cards.map((card) =>
                db.insert(cards).values({ ...audit, matchId, ...card }),
              ),
              ...records.substitutions.map((substitution) =>
                db.insert(substitutions).values({ ...audit, matchId, ...substitution }),
              ),
              ...records.crewAssignments.map((assignment) =>
                db.insert(crewAssignments).values({ ...audit, matchId, ...assignment }),
              ),
            ]),
          );
          return { outcome: 'RECORDED' as const, matchId };
        }),
    });
    // NDJSON, not JSON: `Cloudflare.RpcWorker.bind`'s client uses
    // `RpcSerialization.layerNdjson`, so the server must match it.
    // Alchemy's two-phase worker: init resolves bindings once and hands back the
    // per-request effect, so the nested Effect is the contract, not an accident.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return RpcServer.toHttpEffect(ServiceRpcs).pipe(
      Effect.provide(
        Layer.mergeAll(handlers, RpcSerialization.layerNdjson, Layer.succeed(MatchDatabase, db)),
      ),
    );
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
);
