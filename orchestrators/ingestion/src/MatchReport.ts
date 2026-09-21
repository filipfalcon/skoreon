import { CardKind, GoalKind, LineupRole, OfficialRole, Sex, Side, Source } from '#Enums';
import * as Schema from 'effect/Schema';

// A match report is what a source page says about one match, read into a
// source-agnostic shape. It carries names as printed, never catalog
// identifiers, so what the page said can be reviewed apart from what it later
// resolves to in the catalog.

// A point in match time as the source prints it. `minute` is the regulation minute,
// `stoppageMinute` the added-time offset when the source publishes one separately.
// FAČR prints a single number, so `stoppageMinute` stays null and a 90 may sit
// anywhere inside added time.
export const Moment = Schema.Struct({
  minute: Schema.Int,
  stoppageMinute: Schema.NullOr(Schema.Int),
});
export type Moment = typeof Moment.Type;

// A name split at the boundary the source uses. FAČR prints family name first, so
// "Sobotková Gabriela Jana" is family "Sobotková" and given "Gabriela Jana".
export const PersonName = Schema.Struct({
  familyName: Schema.NonEmptyString,
  givenName: Schema.NonEmptyString,
});
export type PersonName = typeof PersonName.Type;

export const Score = Schema.Struct({
  home: Schema.Int,
  away: Schema.Int,
});
export type Score = typeof Score.Type;

export const TeamSheetEntry = Schema.Struct({
  name: PersonName,
  shirtNumber: Schema.Int,
  role: LineupRole,
  // Goalkeeper is the only position a team sheet reveals. Everything else is unknown
  // to the report and stays unknown until a richer source fills it in.
  isGoalkeeper: Schema.Boolean,
  isStartingCaptain: Schema.Boolean,
});
export type TeamSheetEntry = typeof TeamSheetEntry.Type;

export const TeamSheet = Schema.Struct({
  name: Schema.NonEmptyString,
  // The source's own identifier for the team, when it publishes one. FAČR links
  // each team to its club, and the link carries the club's identifier.
  sourceId: Schema.NullOr(Schema.NonEmptyString),
  entries: Schema.Array(TeamSheetEntry),
});
export type TeamSheet = typeof TeamSheet.Type;

export const Goal = Schema.Struct({
  side: Side,
  scorer: PersonName,
  kind: GoalKind,
  at: Moment,
});
export type Goal = typeof Goal.Type;

export const Card = Schema.Struct({
  side: Side,
  player: PersonName,
  kind: CardKind,
  at: Moment,
});
export type Card = typeof Card.Type;

// Who went off and who came on. FAČR names the counterpart on both rows of a
// change, so a substitution is read, not paired.
export const Substitution = Schema.Struct({
  side: Side,
  outgoing: PersonName,
  incoming: PersonName,
  at: Moment,
});
export type Substitution = typeof Substitution.Type;

export const Official = Schema.Struct({
  role: OfficialRole,
  name: PersonName,
});
export type Official = typeof Official.Type;

export const MatchReport = Schema.Struct({
  source: Schema.Struct({
    provider: Source,
    // The source's own identifier for the match, when it publishes one. FAČR prints
    // it as "Číslo utkání" and it is the natural key for re-ingesting the same page.
    matchNumber: Schema.NullOr(Schema.NonEmptyString),
  }),
  competition: Schema.Struct({
    name: Schema.NonEmptyString,
    // The catalog stores sex on persons only, so a new player's sex has to come from
    // the report. FAČR reveals it through the breadcrumb, "Soutěže žen" for women.
    sex: Sex,
  }),
  round: Schema.Struct({
    name: Schema.NonEmptyString,
    // Ordinal parsed from the name when it carries one, "1.kolo" giving 1.
    position: Schema.NullOr(Schema.Int),
  }),
  // Local wall-clock time as printed, kept apart from the zone. Converting to an
  // instant is the writer's job, not the report's.
  kickoff: Schema.Struct({
    date: Schema.NonEmptyString,
    time: Schema.NonEmptyString,
    timezone: Schema.NonEmptyString,
  }),
  venue: Schema.NullOr(Schema.NonEmptyString),
  attendance: Schema.NullOr(Schema.Int),
  fullTimeScore: Score,
  halfTimeScore: Schema.NullOr(Score),
  // The shoot-out that decided a drawn tie; the full-time score is the draw.
  penaltyShootout: Schema.NullOr(Score),
  home: TeamSheet,
  away: TeamSheet,
  goals: Schema.Array(Goal),
  cards: Schema.Array(Card),
  substitutions: Schema.Array(Substitution),
  officials: Schema.Array(Official),
});
export type MatchReport = typeof MatchReport.Type;
