import { CardKind, GoalKind, LineupRole, MatchStatus, OfficialRole } from '#schema/Enums';
import * as Schema from 'effect/Schema';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';

const greet = Rpc.make('greet', {
  payload: { name: Schema.String },
  success: Schema.String,
});

const moment = { minute: Schema.Int, stoppageMinute: Schema.NullOr(Schema.Int) };

// One match with everything a report says about it, identifiers included:
// the caller allocates them, so a repeated call writes nothing twice.
export const MatchRecords = Schema.Struct({
  match: Schema.Struct({
    id: Schema.String,
    editionId: Schema.String,
    roundId: Schema.String,
    homeParticipationId: Schema.String,
    awayParticipationId: Schema.String,
    status: MatchStatus,
    number: Schema.NullOr(Schema.String),
    // The kickoff instant in ISO 8601.
    kickoffAt: Schema.String,
    timezone: Schema.String,
    venue: Schema.NullOr(Schema.String),
    durationMinutes: Schema.NullOr(Schema.Int),
    homeScore: Schema.Int,
    awayScore: Schema.Int,
    homeHalfTimeScore: Schema.NullOr(Schema.Int),
    awayHalfTimeScore: Schema.NullOr(Schema.Int),
    homePenaltyScore: Schema.NullOr(Schema.Int),
    awayPenaltyScore: Schema.NullOr(Schema.Int),
    attendance: Schema.NullOr(Schema.Int),
  }),
  lineups: Schema.Array(Schema.Struct({ id: Schema.String, participationId: Schema.String })),
  lineupEntries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      lineupId: Schema.String,
      registrationId: Schema.String,
      role: LineupRole,
      shirtNumber: Schema.Int,
      isStartingCaptain: Schema.Boolean,
    }),
  ),
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      participationId: Schema.String,
      registrationId: Schema.NullOr(Schema.String),
      kind: GoalKind,
      ...moment,
    }),
  ),
  cards: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      participationId: Schema.String,
      registrationId: Schema.String,
      kind: CardKind,
      ...moment,
    }),
  ),
  substitutions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      participationId: Schema.String,
      outgoingRegistrationId: Schema.String,
      incomingRegistrationId: Schema.String,
      ...moment,
    }),
  ),
  crewAssignments: Schema.Array(
    Schema.Struct({ id: Schema.String, personId: Schema.String, role: OfficialRole }),
  ),
});
export type MatchRecords = typeof MatchRecords.Type;

// Whether the match was written: it was, it already had been under the same
// identifier, or another match already holds the number.
export const RecordMatchOutcome = Schema.Literals(['RECORDED', 'ALREADY_RECORDED', 'NUMBER_TAKEN']);
export type RecordMatchOutcome = typeof RecordMatchOutcome.Type;

const recordMatch = Rpc.make('recordMatch', {
  payload: MatchRecords.fields,
  success: Schema.Struct({ outcome: RecordMatchOutcome, matchId: Schema.String }),
});

export class ServiceRpcs extends RpcGroup.make(greet, recordMatch) {}
