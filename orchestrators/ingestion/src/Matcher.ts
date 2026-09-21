import type { CatalogClient } from '#Catalog';
import { OfficialRole, type Side } from '#Enums';
import {
  normalizeName,
  type NormalizedPlayer,
  type NormalizedReport,
  type NormalizedTeam,
  type PersonNameKey,
} from '#Normalizer';
import {
  type Candidate,
  type CreateDecision,
  OfficialCreate,
  PlayerCreate,
  type ReviewDecision,
  TeamCreate,
  Unmatched,
  type UnmatchedKind,
} from '@skoreon/api-gateway-contract/Matches';
import type { EditionOnDate, FoundPerson } from '@skoreon/catalog-service/rpcs';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

// Where the report's names land in the catalog. Every identifier is null until
// its key matched exactly one catalog row, or a reviewer decided it; a record
// to create is carried as the reviewer spelled it out; everything still open
// is listed with the candidates a reviewer can choose from. Nothing is guessed
// and nothing is written here.

// Set from the most settled down: an existing registration, an existing
// player still to register, a person still to create.
export const ResolvedPlayer = Schema.Struct({
  shirtNumber: Schema.Int,
  printed: Schema.String,
  registrationId: Schema.NullOr(Schema.String),
  playerId: Schema.NullOr(Schema.String),
  create: Schema.NullOr(PlayerCreate),
});
export type ResolvedPlayer = typeof ResolvedPlayer.Type;

export const ResolvedSide = Schema.Struct({
  participationId: Schema.NullOr(Schema.String),
  create: Schema.NullOr(TeamCreate),
  players: Schema.Array(ResolvedPlayer),
});
export type ResolvedSide = typeof ResolvedSide.Type;

export const ResolvedOfficial = Schema.Struct({
  role: OfficialRole,
  printed: Schema.String,
  personId: Schema.NullOr(Schema.String),
  create: Schema.NullOr(OfficialCreate),
});
export type ResolvedOfficial = typeof ResolvedOfficial.Type;

export const Matched = Schema.Struct({
  editionId: Schema.NullOr(Schema.String),
  roundId: Schema.NullOr(Schema.String),
  home: ResolvedSide,
  away: ResolvedSide,
  officials: Schema.Array(ResolvedOfficial),
  unmatched: Schema.Array(Unmatched),
});
export type Matched = typeof Matched.Type;

type Participation = EditionOnDate['participations'][number];
type Registration = Participation['registrations'][number];

const only = <T>(matches: ReadonlyArray<T>): T | null =>
  matches.length === 1 ? matches[0]! : null;

const personKeyOf = (person: { givenName: string; familyName: string }): string =>
  normalizeName(`${person.familyName} ${person.givenName}`);

const printedName = (person: { givenName: string; familyName: string }): string =>
  `${person.familyName} ${person.givenName}`;

// A decision answers one unmatched item; it applies when its kind, side and
// printed name are the ones the item was listed with.
const decisionFor = (
  decisions: ReadonlyArray<ReviewDecision>,
  kind: UnmatchedKind,
  side: Side | null,
  printed: string,
): ReviewDecision | undefined =>
  decisions.find(
    (decision) => decision.kind === kind && decision.side === side && decision.printed === printed,
  );

const picked = (
  decisions: ReadonlyArray<ReviewDecision>,
  kind: UnmatchedKind,
  side: Side | null,
  printed: string,
): string | null => {
  const decision = decisionFor(decisions, kind, side, printed);
  return decision !== undefined && 'candidateId' in decision ? decision.candidateId : null;
};

// The kind was matched by `decisionFor`, so the decision's record is the
// kind's record.
function created(
  decisions: ReadonlyArray<ReviewDecision>,
  kind: 'TEAM',
  side: Side | null,
  printed: string,
): TeamCreate | null;
function created(
  decisions: ReadonlyArray<ReviewDecision>,
  kind: 'PLAYER',
  side: Side | null,
  printed: string,
): PlayerCreate | null;
function created(
  decisions: ReadonlyArray<ReviewDecision>,
  kind: 'OFFICIAL',
  side: Side | null,
  printed: string,
): OfficialCreate | null;
function created(
  decisions: ReadonlyArray<ReviewDecision>,
  kind: CreateDecision['kind'],
  side: Side | null,
  printed: string,
): CreateDecision['create'] | null {
  const decision = decisionFor(decisions, kind, side, printed);
  return decision !== undefined && 'create' in decision ? decision.create : null;
}

export const matchReport = (
  report: NormalizedReport,
  editions: ReadonlyArray<EditionOnDate>,
  persons: ReadonlyArray<FoundPerson>,
  decisions: ReadonlyArray<ReviewDecision> = [],
): Matched => {
  const unmatched: Array<Unmatched> = [];

  const decidedEdition = picked(decisions, 'COMPETITION', null, report.competition.printed);
  const edition = only(
    editions.filter((edition) =>
      decidedEdition !== null
        ? edition.id === decidedEdition
        : normalizeName(edition.competition.name) === report.competition.key,
    ),
  );
  if (edition === null) {
    unmatched.push({
      kind: 'COMPETITION',
      side: null,
      printed: report.competition.printed,
      candidates: editions.map((edition) => ({ id: edition.id, name: edition.competition.name })),
      creation: null,
    });
  }

  // Only phases covering the kickoff date are in play, so a first round of the
  // main phase and a first round of a later one never compete.
  const rounds =
    edition?.phases
      .filter((phase) => phase.startsOn <= report.kickoffDate && report.kickoffDate <= phase.endsOn)
      .flatMap((phase) =>
        phase.rounds.map((round) => ({ ...round, name: `${phase.name} ${round.name}` })),
      ) ?? [];
  const decidedRound = picked(decisions, 'ROUND', null, report.round.printed);
  const round =
    edition === null
      ? null
      : only(
          rounds.filter((round) =>
            decidedRound !== null
              ? round.id === decidedRound
              : report.round.position !== null
                ? round.position === report.round.position
                : normalizeName(round.name) === report.round.key,
          ),
        );
  if (edition !== null && round === null) {
    unmatched.push({
      kind: 'ROUND',
      side: null,
      printed: report.round.printed,
      candidates: rounds,
      creation: null,
    });
  }

  // A player is looked for among the team's registrations first, then among
  // every person of that name in the catalog. A registration settles it; a
  // known but unregistered player, or more than one of either, is the
  // reviewer's to settle, and so is a player nobody has heard of.
  const resolvePlayer = (
    side: Side,
    player: NormalizedPlayer,
    registrations: ReadonlyArray<Registration>,
  ): ResolvedPlayer => {
    const { printed, key, givenName, familyName } = player.name;
    const resolved = { shirtNumber: player.shirtNumber, printed };

    const create = created(decisions, 'PLAYER', side, printed);
    if (create !== null) return { ...resolved, registrationId: null, playerId: null, create };

    const pickedId = picked(decisions, 'PLAYER', side, printed);
    if (pickedId !== null) {
      const registration = registrations.find(({ player }) => player.id === pickedId);
      if (registration !== undefined) {
        return { ...resolved, registrationId: registration.id, playerId: pickedId, create: null };
      }
      if (persons.some((person) => person.players.some((player) => player.id === pickedId))) {
        return { ...resolved, registrationId: null, playerId: pickedId, create: null };
      }
    }

    const registered = registrations.filter(({ player }) => personKeyOf(player.person) === key);
    const registration = pickedId === null ? only(registered) : null;
    if (registration !== null) {
      return {
        ...resolved,
        registrationId: registration.id,
        playerId: registration.player.id,
        create: null,
      };
    }

    const known = persons
      .filter((person) => personKeyOf(person) === key)
      .flatMap((person) =>
        person.players
          .filter(
            (player) => !registered.some((registration) => registration.player.id === player.id),
          )
          .map((player) => ({ id: player.id, name: printedName(person), registered: false })),
      );
    unmatched.push({
      kind: 'PLAYER',
      side,
      printed,
      candidates: [
        ...registered.map(({ player }): Candidate => ({
          id: player.id,
          name: printedName(player.person),
          registered: true,
        })),
        ...known,
      ],
      creation: {
        givenName,
        familyName,
        sex: report.sex,
        dateOfBirth: null,
        nationality: null,
        // Goalkeeper is the only position a team sheet reveals.
        primaryPosition: player.isGoalkeeper ? 'GOALKEEPER' : null,
      },
    });
    return { ...resolved, registrationId: null, playerId: null, create: null };
  };

  // A team is settled by the source's own identifier when the catalog has
  // learned it, else by its spelling, the catalog's name or a learned alias.
  const resolveSide = (side: Side, sheet: NormalizedTeam): ResolvedSide => {
    let participation: Participation | null = null;
    let create: TeamCreate | null = null;
    if (edition !== null) {
      create = created(decisions, 'TEAM', side, sheet.team.printed);
      const pickedId = picked(decisions, 'TEAM', side, sheet.team.printed);
      const byId = edition.participations.filter((participation) =>
        participation.team.sourceIds.some(
          (sourceId) =>
            sourceId.source === report.source && sourceId.externalId === sheet.team.sourceId,
        ),
      );
      const byName = edition.participations.filter(
        (participation) =>
          normalizeName(participation.team.name) === sheet.team.key ||
          participation.team.aliases.some(
            (alias) =>
              alias.source === report.source && normalizeName(alias.name) === sheet.team.key,
          ),
      );
      participation =
        create !== null
          ? null
          : pickedId !== null
            ? (edition.participations.find((participation) => participation.id === pickedId) ??
              null)
            : only(byId.length > 0 ? byId : byName);
      if (participation === null && create === null) {
        unmatched.push({
          kind: 'TEAM',
          side,
          printed: sheet.team.printed,
          candidates: edition.participations.map(({ id, team }) => ({ id, name: team.name })),
          creation: { name: sheet.team.printed, establishedOn: null },
        });
      }
    }
    // Players are looked for once their team is known: against an unknown
    // team every player would look new, and a reviewer might create what is
    // merely registered with the team not yet picked.
    const known = participation !== null || create !== null;
    return {
      participationId: participation?.id ?? null,
      create,
      players: sheet.players.map((player) =>
        known
          ? resolvePlayer(side, player, participation?.registrations ?? [])
          : {
              shirtNumber: player.shirtNumber,
              printed: player.name.printed,
              registrationId: null,
              playerId: null,
              create: null,
            },
      ),
    };
  };

  const resolveOfficial = (role: OfficialRole, name: PersonNameKey): ResolvedOfficial => {
    const { printed, key, givenName, familyName } = name;
    const create = created(decisions, 'OFFICIAL', null, printed);
    if (create !== null) return { role, printed, personId: null, create };

    const pickedId = picked(decisions, 'OFFICIAL', null, printed);
    const byKey = persons.filter((person) => personKeyOf(person) === key);
    const person =
      pickedId !== null ? (persons.find((person) => person.id === pickedId) ?? null) : only(byKey);
    if (person !== null) return { role, printed, personId: person.id, create: null };

    unmatched.push({
      kind: 'OFFICIAL',
      side: null,
      printed,
      candidates: byKey.map((person) => ({ id: person.id, name: printedName(person) })),
      creation: { givenName, familyName, sex: null, dateOfBirth: null, nationality: null },
    });
    return { role, printed, personId: null, create: null };
  };

  return {
    editionId: edition?.id ?? null,
    roundId: round?.id ?? null,
    home: resolveSide('HOME', report.home),
    away: resolveSide('AWAY', report.away),
    officials: report.officials.map(({ role, name }) => resolveOfficial(role, name)),
    unmatched,
  };
};

const familyNamesOf = (report: NormalizedReport): Array<string> => [
  ...new Set(
    [...report.home.players, ...report.away.players, ...report.officials].map(
      ({ name }) => name.familyName,
    ),
  ),
];

export const matchWithCatalog = (
  catalog: CatalogClient,
  report: NormalizedReport,
  decisions: ReadonlyArray<ReviewDecision> = [],
) =>
  Effect.all(
    [
      catalog.listEditionsOn({ date: report.kickoffDate }),
      catalog.findPersons({ familyNames: familyNamesOf(report) }),
    ],
    { concurrency: 'unbounded' },
  ).pipe(Effect.map(([editions, persons]) => matchReport(report, editions, persons, decisions)));

// The decisions that answer what was asked: each names a listed item and
// either picks one of the candidates it was listed with or creates what the
// item said could be created. Anything else is dropped before it can be
// matched on or learned from.
export const applicableDecisions = (
  unmatched: ReadonlyArray<Unmatched>,
  decisions: ReadonlyArray<ReviewDecision>,
): ReadonlyArray<ReviewDecision> =>
  decisions.filter((decision) =>
    unmatched.some(
      (item) =>
        item.kind === decision.kind &&
        item.side === decision.side &&
        item.printed === decision.printed &&
        ('create' in decision
          ? item.creation !== null
          : item.candidates.some((candidate) => candidate.id === decision.candidateId)),
    ),
  );

// What a reviewer taught: every team picked becomes an alias of the chosen
// participant's team, spelled the way the source printed it, and, where the
// source identifies the team, the identifier is learned as well. A spelling
// or identifier that already names another team is left as it is and
// reported: this run still resolves by the decision, the catalog does not
// change its mind. A team created gets both with the rest of its records.
export const learnFromDecisions = (
  catalog: CatalogClient,
  report: NormalizedReport,
  decisions: ReadonlyArray<ReviewDecision>,
) =>
  Effect.forEach(
    decisions.flatMap((decision) =>
      decision.kind === 'TEAM' && 'candidateId' in decision && decision.side !== null
        ? [{ decision, side: decision.side }]
        : [],
    ),
    ({ decision, side }) => {
      const sourceId = report[side === 'HOME' ? 'home' : 'away'].team.sourceId;
      const reported = (what: string) => (outcome: { outcome: string }) =>
        outcome.outcome === 'CONFLICT'
          ? Effect.logWarning(
              `Team ${what} from ${report.source} already names another team; not relearned`,
            )
          : Effect.void;
      return Effect.all([
        catalog
          .learnTeamAlias({
            participationId: decision.candidateId,
            source: report.source,
            name: decision.printed,
          })
          .pipe(Effect.flatMap(reported(`alias "${decision.printed}"`))),
        sourceId === null
          ? Effect.void
          : catalog
              .learnTeamSourceId({
                participationId: decision.candidateId,
                source: report.source,
                externalId: sourceId,
              })
              .pipe(Effect.flatMap(reported(`identifier "${sourceId}"`))),
      ]);
    },
    { discard: true },
  );
