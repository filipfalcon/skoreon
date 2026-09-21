import {
  FifaCountry,
  PhaseFormat,
  PhaseRole,
  PlayerPosition,
  Sex,
  Source,
  TeamKind,
} from '#schema/Enums';
import * as Schema from 'effect/Schema';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';

const greet = Rpc.make('greet', {
  payload: { name: Schema.String },
  success: Schema.String,
});

const Person = Schema.Struct({
  id: Schema.String,
  givenName: Schema.String,
  familyName: Schema.String,
  sex: Sex,
  nationality: FifaCountry,
  dateOfBirth: Schema.String,
});

const Club = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export const Player = Schema.Struct({
  id: Schema.String,
  primaryPosition: PlayerPosition,
  person: Person,
  currentClub: Schema.NullOr(Club),
});

export const PlayerPage = Schema.Struct({
  items: Schema.Array(Player),
  total: Schema.Int,
  page: Schema.Int,
  pageSize: Schema.Int,
});

const listPlayers = Rpc.make('listPlayers', {
  payload: { page: Schema.optional(Schema.Int), pageSize: Schema.optional(Schema.Int) },
  success: PlayerPage,
});

export const Team = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: TeamKind,
  country: FifaCountry,
  establishedOn: Schema.String,
});

const listTeams = Rpc.make('listTeams', {
  payload: { kind: Schema.optional(TeamKind), country: Schema.optional(FifaCountry) },
  success: Schema.Array(Team),
});

const getTeam = Rpc.make('getTeam', {
  payload: { id: Schema.String },
  success: Schema.NullOr(Team),
});

// Everything a match page can be resolved against on the day it was played:
// the editions running that day, each with its competition, its phases and
// their rounds, and its participants under every spelling a source has taught
// the catalog.
export const EditionOnDate = Schema.Struct({
  id: Schema.String,
  startsOn: Schema.String,
  endsOn: Schema.String,
  competition: Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
  phases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      format: PhaseFormat,
      role: PhaseRole,
      startsOn: Schema.String,
      endsOn: Schema.String,
      rounds: Schema.Array(
        Schema.Struct({ id: Schema.String, name: Schema.String, position: Schema.Int }),
      ),
    }),
  ),
  participations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      team: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        aliases: Schema.Array(Schema.Struct({ source: Source, name: Schema.String })),
        sourceIds: Schema.Array(Schema.Struct({ source: Source, externalId: Schema.String })),
      }),
      registrations: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          player: Schema.Struct({
            id: Schema.String,
            person: Schema.Struct({ givenName: Schema.String, familyName: Schema.String }),
          }),
        }),
      ),
    }),
  ),
});
export type EditionOnDate = typeof EditionOnDate.Type;

// Persons by family name, with the player rows they hold: the family name is
// taken as printed and narrows the search, the full name is compared by key
// on the caller's side.
export const FoundPerson = Schema.Struct({
  id: Schema.String,
  givenName: Schema.String,
  familyName: Schema.String,
  players: Schema.Array(Schema.Struct({ id: Schema.String })),
});
export type FoundPerson = typeof FoundPerson.Type;

const findPersons = Rpc.make('findPersons', {
  payload: { familyNames: Schema.Array(Schema.String) },
  success: Schema.Array(FoundPerson),
});

// Everything an approved ingestion adds to the catalog, identifiers included:
// the caller allocates them, so a repeated call adds nothing twice.
export const IngestionRecords = Schema.Struct({
  teams: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      kind: TeamKind,
      country: FifaCountry,
      establishedOn: Schema.String,
    }),
  ),
  participations: Schema.Array(
    Schema.Struct({ id: Schema.String, editionId: Schema.String, teamId: Schema.String }),
  ),
  teamAliases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      teamId: Schema.String,
      source: Source,
      name: Schema.String,
    }),
  ),
  teamSourceIds: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      teamId: Schema.String,
      source: Source,
      externalId: Schema.String,
    }),
  ),
  persons: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      givenName: Schema.String,
      familyName: Schema.String,
      sex: Sex,
      nationality: FifaCountry,
      dateOfBirth: Schema.String,
    }),
  ),
  players: Schema.Array(
    Schema.Struct({ id: Schema.String, personId: Schema.String, primaryPosition: PlayerPosition }),
  ),
  registrations: Schema.Array(
    Schema.Struct({ id: Schema.String, participationId: Schema.String, playerId: Schema.String }),
  ),
});
export type IngestionRecords = typeof IngestionRecords.Type;

const createIngestionRecords = Rpc.make('createIngestionRecords', {
  payload: IngestionRecords.fields,
  success: Schema.Void,
});

const listEditionsOn = Rpc.make('listEditionsOn', {
  payload: { date: Schema.String },
  success: Schema.Array(EditionOnDate),
});

// What learning came to: new, already this team's, already another team's, or
// nothing because the participation is gone.
export const LearnOutcome = Schema.Literals(['LEARNED', 'KNOWN', 'CONFLICT', 'NO_PARTICIPATION']);
export type LearnOutcome = typeof LearnOutcome.Type;

// A spelling a reviewer resolved to a participant's team. Learned once, the
// same spelling from the same source matches by itself from then on. One
// spelling names one team per source, so a decision that contradicts an
// earlier one is reported rather than applied.
const learnTeamAlias = Rpc.make('learnTeamAlias', {
  payload: { participationId: Schema.String, source: Source, name: Schema.NonEmptyString },
  success: Schema.Struct({ outcome: LearnOutcome }),
});

// A source's identifier a reviewer resolved to a participant's team. One
// identifier names one team per source, like a spelling.
const learnTeamSourceId = Rpc.make('learnTeamSourceId', {
  payload: { participationId: Schema.String, source: Source, externalId: Schema.NonEmptyString },
  success: Schema.Struct({ outcome: LearnOutcome }),
});

export class ServiceRpcs extends RpcGroup.make(
  greet,
  listPlayers,
  listTeams,
  getTeam,
  listEditionsOn,
  learnTeamAlias,
  learnTeamSourceId,
  findPersons,
  createIngestionRecords,
) {}
