import { LineupRole, OfficialRole, Sex, Side, Source } from '#Enums';
import { type MatchReport, Moment, type PersonName } from '#MatchReport';
import * as Schema from 'effect/Schema';

// Two spellings are the same name when they differ only in case, diacritics,
// punctuation or spacing: "1.FC Slovácko" and "1. FC Slovacko" share a key,
// "Slavia Praha" and "SK Slavia Praha" do not. Anything looser is a guess.
export const normalizeName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// A name as printed next to the key it is compared by. The printed form stays
// for the reviewer and for learning an alias; the key is what matching uses.
export const NameKey = Schema.Struct({
  printed: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
});
export type NameKey = typeof NameKey.Type;

// A person's name keeps its two parts as well: creating the person needs
// them apart, matching needs them together.
export const PersonNameKey = Schema.Struct({
  ...NameKey.fields,
  familyName: Schema.NonEmptyString,
  givenName: Schema.NonEmptyString,
});
export type PersonNameKey = typeof PersonNameKey.Type;

export const NormalizedPlayer = Schema.Struct({
  shirtNumber: Schema.Int,
  role: LineupRole,
  name: PersonNameKey,
  isGoalkeeper: Schema.Boolean,
  isStartingCaptain: Schema.Boolean,
});
export type NormalizedPlayer = typeof NormalizedPlayer.Type;

// A team by its spelling and, where the source publishes one, its identifier.
export const NormalizedTeam = Schema.Struct({
  team: Schema.Struct({ ...NameKey.fields, sourceId: Schema.NullOr(Schema.String) }),
  players: Schema.Array(NormalizedPlayer),
});
export type NormalizedTeam = typeof NormalizedTeam.Type;

// A change by shirt numbers, which are unique on a sheet where names need not be.
export const NormalizedSubstitution = Schema.Struct({
  side: Side,
  outgoingShirtNumber: Schema.Int,
  incomingShirtNumber: Schema.Int,
  at: Moment,
});
export type NormalizedSubstitution = typeof NormalizedSubstitution.Type;

// The report reduced to what matching looks at: every name with its key, the
// date that selects the editions, the ordinal that selects the round, and
// what a new record would inherit from the page.
export const NormalizedReport = Schema.Struct({
  source: Source,
  matchNumber: Schema.NullOr(Schema.NonEmptyString),
  kickoffDate: Schema.NonEmptyString,
  sex: Sex,
  competition: NameKey,
  round: Schema.Struct({ ...NameKey.fields, position: Schema.NullOr(Schema.Int) }),
  home: NormalizedTeam,
  away: NormalizedTeam,
  substitutions: Schema.Array(NormalizedSubstitution),
  officials: Schema.Array(Schema.Struct({ role: OfficialRole, name: PersonNameKey })),
});
export type NormalizedReport = typeof NormalizedReport.Type;

const nameKey = (printed: string): NameKey => ({ printed, key: normalizeName(printed) });

// Person keys are built from the printed order, family name first, so the key
// of a sheet row and the key of a goal scorer agree.
export const personKey = ({ familyName, givenName }: PersonName): PersonNameKey => ({
  ...nameKey(`${familyName} ${givenName}`),
  familyName,
  givenName,
});

const normalizeTeam = (sheet: MatchReport['home']): NormalizedTeam => ({
  team: { ...nameKey(sheet.name), sourceId: sheet.sourceId },
  players: sheet.entries.map((entry) => ({
    shirtNumber: entry.shirtNumber,
    role: entry.role,
    name: personKey(entry.name),
    isGoalkeeper: entry.isGoalkeeper,
    isStartingCaptain: entry.isStartingCaptain,
  })),
});

export const normalizeReport = (report: MatchReport): NormalizedReport => {
  // The reader put every player of a change on its sheet, so a missing one is
  // a bug in the reader, not a condition to handle.
  const shirtNumber = (side: MatchReport['substitutions'][number]['side'], name: PersonName) => {
    const entry = report[side === 'HOME' ? 'home' : 'away'].entries.find(
      (entry) =>
        entry.name.familyName === name.familyName && entry.name.givenName === name.givenName,
    );
    if (entry === undefined) {
      throw new Error(`"${name.familyName} ${name.givenName}" is not on the ${side} team sheet`);
    }
    return entry.shirtNumber;
  };
  return {
    source: report.source.provider,
    matchNumber: report.source.matchNumber,
    kickoffDate: report.kickoff.date,
    sex: report.competition.sex,
    competition: nameKey(report.competition.name),
    round: { ...nameKey(report.round.name), position: report.round.position },
    home: normalizeTeam(report.home),
    away: normalizeTeam(report.away),
    substitutions: report.substitutions.map((substitution) => ({
      side: substitution.side,
      outgoingShirtNumber: shirtNumber(substitution.side, substitution.outgoing),
      incomingShirtNumber: shirtNumber(substitution.side, substitution.incoming),
      at: substitution.at,
    })),
    officials: report.officials.map((official) => ({
      role: official.role,
      name: personKey(official.name),
    })),
  };
};
