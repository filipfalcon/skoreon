import { CatalogDatabase } from '#Database';
import { uuidV7 } from '#Ids';
import { ServiceRpcs } from '#rpcs';
import { participations } from '#schema/Participations';
import { persons } from '#schema/Persons';
import { players } from '#schema/Players';
import { registrations } from '#schema/Registrations';
import { relations } from '#schema/Relations';
import { teamAliases } from '#schema/TeamAliases';
import { teamSourceIds } from '#schema/TeamSourceIds';
import { teams } from '#schema/Teams';
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

// The class is only an identifier, so the gateway and the ingestion worker can
// bind to this service without evaluating its runtime in their own. The
// runtime lives in the default export, which only the stack provides.
export class CatalogService extends Cloudflare.RpcWorker<CatalogService>()(
  'CatalogServiceRpcWorker',
  { schema: ServiceRpcs },
) {}

export default CatalogService.make(
  { main: import.meta.url },
  Effect.gen(function* () {
    // Resources live on the edge in every environment, dev included; only the
    // code runs locally. The database is therefore never emulated.
    const database = yield* Cloudflare.D1.Database('CatalogD1Database', {
      migrations: { dir: './services/catalog/migrations', table: 'drizzle_migrations' },
    }).pipe(Alchemy.remote());
    const connection = yield* Cloudflare.D1.QueryDatabase(database);
    const db = drizzle(yield* connection.raw, { relations });

    // Learns one fact about a participant's team, a spelling or a source's
    // identifier. The fact is inserted if new; if taken, whose it is decides
    // whether that is old news or a contradiction.
    const learn = (
      participationId: string,
      insert: (
        teamId: string,
        audit: {
          id: string;
          createdAt: Date;
          createdBy: string;
          updatedAt: Date;
          updatedBy: string;
        },
      ) => Promise<ReadonlyArray<{ id: string }>>,
      owner: () => Promise<{ teamId: string } | undefined>,
    ) =>
      Effect.gen(function* () {
        const participation = yield* Effect.promise(() =>
          db.query.participations.findFirst({
            columns: { teamId: true },
            where: { id: participationId, deletedAt: { isNull: true } },
          }),
        );
        if (participation === undefined) return { outcome: 'NO_PARTICIPATION' as const };
        const id = yield* uuidV7;
        const at = DateTime.toDate(yield* DateTime.now);
        const inserted = yield* Effect.promise(() =>
          insert(participation.teamId, {
            id,
            createdAt: at,
            createdBy: 'INGESTION',
            updatedAt: at,
            updatedBy: 'INGESTION',
          }),
        );
        if (inserted.length > 0) return { outcome: 'LEARNED' as const };
        const existing = yield* Effect.promise(owner);
        return {
          outcome: existing?.teamId === participation.teamId ? 'KNOWN' : 'CONFLICT',
        } as const;
      });

    const handlers = ServiceRpcs.toLayer({
      greet: ({ name }) => Effect.succeed(`Hello ${name}`),
      listPlayers: ({ page = 1, pageSize = 20 }) =>
        Effect.gen(function* () {
          const [rows, countRows] = yield* Effect.all(
            [
              Effect.promise(() =>
                db.query.players.findMany({
                  columns: { id: true, primaryPosition: true },
                  with: {
                    person: {
                      columns: {
                        id: true,
                        givenName: true,
                        familyName: true,
                        sex: true,
                        nationality: true,
                        dateOfBirth: true,
                      },
                    },
                    registrations: {
                      where: { deletedAt: { isNull: true } },
                      with: {
                        participation: {
                          with: {
                            team: { columns: { id: true, name: true, kind: true } },
                            edition: { columns: { startsOn: true, endsOn: true } },
                          },
                        },
                      },
                    },
                  },
                  where: { deletedAt: { isNull: true } },
                  orderBy: { createdAt: 'asc' },
                  limit: pageSize,
                  offset: (page - 1) * pageSize,
                }),
              ),
              Effect.promise(() =>
                db
                  .select({ total: sql<number>`count(*)` })
                  .from(players)
                  .where(isNull(players.deletedAt)),
              ),
            ],
            { concurrency: 'unbounded' },
          );
          const total = countRows[0]?.total ?? 0;

          const today = DateTime.formatIsoDate(yield* DateTime.now);
          const items = rows.map(({ registrations, ...player }) => {
            const currentClub =
              registrations.find(
                ({ participation }) =>
                  participation.team.kind === 'CLUB' &&
                  participation.edition.startsOn <= today &&
                  today <= participation.edition.endsOn,
              )?.participation.team ?? null;
            return { ...player, currentClub };
          });

          return { items, total, page, pageSize };
        }),
      listTeams: ({ kind, country }) =>
        Effect.promise(() =>
          db.query.teams.findMany({
            where: {
              deletedAt: { isNull: true },
              ...(kind !== undefined ? { kind } : {}),
              ...(country !== undefined ? { country } : {}),
            },
          }),
        ),
      getTeam: ({ id }) =>
        Effect.promise(() =>
          db.query.teams.findFirst({ where: { id, deletedAt: { isNull: true } } }),
        ).pipe(Effect.map((team) => team ?? null)),
      listEditionsOn: ({ date }) =>
        Effect.promise(() =>
          db.query.editions.findMany({
            columns: { id: true, startsOn: true, endsOn: true },
            where: { deletedAt: { isNull: true }, startsOn: { lte: date }, endsOn: { gte: date } },
            with: {
              competition: { columns: { id: true, code: true, name: true } },
              phases: {
                columns: {
                  id: true,
                  name: true,
                  format: true,
                  role: true,
                  startsOn: true,
                  endsOn: true,
                },
                where: { deletedAt: { isNull: true } },
                with: {
                  rounds: {
                    columns: { id: true, name: true, position: true },
                    where: { deletedAt: { isNull: true } },
                    orderBy: { position: 'asc' },
                  },
                },
              },
              participations: {
                columns: { id: true },
                where: { deletedAt: { isNull: true } },
                with: {
                  team: {
                    columns: { id: true, name: true },
                    with: {
                      aliases: {
                        columns: { source: true, name: true },
                        where: { deletedAt: { isNull: true } },
                      },
                      sourceIds: {
                        columns: { source: true, externalId: true },
                        where: { deletedAt: { isNull: true } },
                      },
                    },
                  },
                  registrations: {
                    columns: { id: true },
                    where: { deletedAt: { isNull: true } },
                    with: {
                      player: {
                        columns: { id: true },
                        with: { person: { columns: { givenName: true, familyName: true } } },
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
      findPersons: ({ familyNames }) =>
        familyNames.length === 0
          ? Effect.succeed([])
          : Effect.promise(() =>
              db.query.persons.findMany({
                columns: { id: true, givenName: true, familyName: true },
                where: { familyName: { in: [...familyNames] }, deletedAt: { isNull: true } },
                with: {
                  players: { columns: { id: true }, where: { deletedAt: { isNull: true } } },
                },
              }),
            ),
      createIngestionRecords: (records) =>
        Effect.gen(function* () {
          const at = DateTime.toDate(yield* DateTime.now);
          const audit = {
            createdAt: at,
            createdBy: 'INGESTION',
            updatedAt: at,
            updatedBy: 'INGESTION',
          };
          // Referenced rows first. Every insert yields to an existing
          // identifier, so a retried call is a no-op.
          const [first, ...rest] = [
            ...records.teams.map((team) =>
              db
                .insert(teams)
                .values({ ...audit, ...team })
                .onConflictDoNothing(),
            ),
            ...records.participations.map((participation) =>
              db
                .insert(participations)
                .values({ ...audit, ...participation })
                .onConflictDoNothing(),
            ),
            ...records.teamAliases.map((alias) =>
              db
                .insert(teamAliases)
                .values({ ...audit, ...alias })
                .onConflictDoNothing(),
            ),
            ...records.teamSourceIds.map((sourceId) =>
              db
                .insert(teamSourceIds)
                .values({ ...audit, ...sourceId })
                .onConflictDoNothing(),
            ),
            ...records.persons.map((person) =>
              db
                .insert(persons)
                .values({ ...audit, ...person })
                .onConflictDoNothing(),
            ),
            ...records.players.map((player) =>
              db
                .insert(players)
                .values({ ...audit, ...player })
                .onConflictDoNothing(),
            ),
            ...records.registrations.map((registration) =>
              db
                .insert(registrations)
                .values({ ...audit, ...registration })
                .onConflictDoNothing(),
            ),
          ];
          if (first !== undefined) yield* Effect.promise(() => db.batch([first, ...rest]));
        }),
      learnTeamAlias: ({ participationId, source, name }) =>
        learn(
          participationId,
          (teamId, audit) =>
            db
              .insert(teamAliases)
              .values({ ...audit, teamId, source, name })
              .onConflictDoNothing()
              .returning({ id: teamAliases.id }),
          () =>
            db.query.teamAliases.findFirst({
              columns: { teamId: true },
              where: { source, name, deletedAt: { isNull: true } },
            }),
        ),
      learnTeamSourceId: ({ participationId, source, externalId }) =>
        learn(
          participationId,
          (teamId, audit) =>
            db
              .insert(teamSourceIds)
              .values({ ...audit, teamId, source, externalId })
              .onConflictDoNothing()
              .returning({ id: teamSourceIds.id }),
          () =>
            db.query.teamSourceIds.findFirst({
              columns: { teamId: true },
              where: { source, externalId, deletedAt: { isNull: true } },
            }),
        ),
    });
    // NDJSON, not JSON: `Cloudflare.RpcWorker.bind`'s client uses
    // `RpcSerialization.layerNdjson`, so the server must match it.
    // Alchemy's two-phase worker: init resolves bindings once and hands back the
    // per-request effect, so the nested Effect is the contract, not an accident.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return RpcServer.toHttpEffect(ServiceRpcs).pipe(
      Effect.provide(
        Layer.mergeAll(handlers, RpcSerialization.layerNdjson, Layer.succeed(CatalogDatabase, db)),
      ),
    );
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
);
