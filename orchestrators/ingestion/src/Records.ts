import type { Side, Source } from '#Enums';
import type { MatchReport, PersonName } from '#MatchReport';
import type { Matched } from '#Matcher';
import { normalizeName, type NormalizedReport } from '#Normalizer';
import type { IngestionRecords } from '@skoreon/catalog-service/rpcs';
import type { MatchRecords } from '@skoreon/match-service/rpcs';
import * as DateTime from 'effect/DateTime';

// The records an approved ingestion writes, laid out from the report and
// where it matched. Identifiers are allocated by label in a step of their
// own, so a retried write reuses them and never doubles a record.

export type Ids = Readonly<Record<string, string>>;

const sides = ['HOME', 'AWAY'] as const;

const sideOf = <T extends { home: unknown; away: unknown }>(
  of: T,
  side: Side,
): T[Side extends 'HOME' ? 'home' : 'away'] => (side === 'HOME' ? of.home : of.away);

const opposite = (side: Side): Side => (side === 'HOME' ? 'AWAY' : 'HOME');

// Labels are computed from the same matched report the records are, so a
// missing one is a bug in this module, not a condition to handle.
const at = (ids: Ids, label: string): string => {
  const id = ids[label];
  if (id === undefined) throw new Error(`No identifier was allocated for ${label}`);
  return id;
};

const settled = <T>(value: T | null, what: string): T => {
  if (value === null) throw new Error(`${what} is unresolved, but the report was approved`);
  return value;
};

export const recordLabels = (
  report: MatchReport,
  normalized: NormalizedReport,
  matched: Matched,
): Array<string> => {
  const labels = ['match', 'lineup:HOME', 'lineup:AWAY'];
  for (const side of sides) {
    const resolved = sideOf(matched, side);
    if (resolved.create !== null) {
      labels.push(`team:${side}`, `participation:${side}`, `alias:${side}`);
      if (sideOf(normalized, side).team.sourceId !== null) labels.push(`sourceId:${side}`);
    }
    for (const player of resolved.players) {
      labels.push(`entry:${side}:${player.shirtNumber}`);
      if (player.create !== null) {
        labels.push(`person:${side}:${player.shirtNumber}`, `player:${side}:${player.shirtNumber}`);
      }
      if (player.registrationId === null) labels.push(`registration:${side}:${player.shirtNumber}`);
    }
  }
  matched.officials.forEach((official, index) => {
    if (official.create !== null) labels.push(`person:official:${index}`);
    labels.push(`crew:${index}`);
  });
  report.goals.forEach((_, index) => labels.push(`goal:${index}`));
  report.cards.forEach((_, index) => labels.push(`card:${index}`));
  normalized.substitutions.forEach((_, index) => labels.push(`substitution:${index}`));
  return labels;
};

// What a source's teams are, when the page cannot say: FAČR reports club
// football in Czechia.
const teamsOf: Record<Source, { kind: 'CLUB'; country: 'CZE' }> = {
  FACR: { kind: 'CLUB', country: 'CZE' },
};

const participationOf = (matched: Matched, ids: Ids, side: Side): string =>
  sideOf(matched, side).participationId ?? at(ids, `participation:${side}`);

const registrationOf = (matched: Matched, ids: Ids, side: Side, shirtNumber: number): string => {
  const player = sideOf(matched, side).players.find((player) => player.shirtNumber === shirtNumber);
  return player?.registrationId ?? at(ids, `registration:${side}:${shirtNumber}`);
};

export const catalogRecords = (
  normalized: NormalizedReport,
  matched: Matched,
  ids: Ids,
): IngestionRecords => {
  const editionId = settled(matched.editionId, 'The edition');
  const teams: Array<IngestionRecords['teams'][number]> = [];
  const participations: Array<IngestionRecords['participations'][number]> = [];
  const teamAliases: Array<IngestionRecords['teamAliases'][number]> = [];
  const teamSourceIds: Array<IngestionRecords['teamSourceIds'][number]> = [];
  const persons: Array<IngestionRecords['persons'][number]> = [];
  const players: Array<IngestionRecords['players'][number]> = [];
  const registrations: Array<IngestionRecords['registrations'][number]> = [];

  for (const side of sides) {
    const resolved = sideOf(matched, side);
    const sheet = sideOf(normalized, side);
    const participationId = participationOf(matched, ids, side);
    if (resolved.create !== null) {
      const teamId = at(ids, `team:${side}`);
      teams.push({ id: teamId, ...teamsOf[normalized.source], ...resolved.create });
      participations.push({ id: participationId, editionId, teamId });
      teamAliases.push({
        id: at(ids, `alias:${side}`),
        teamId,
        source: normalized.source,
        name: sheet.team.printed,
      });
      if (sheet.team.sourceId !== null) {
        teamSourceIds.push({
          id: at(ids, `sourceId:${side}`),
          teamId,
          source: normalized.source,
          externalId: sheet.team.sourceId,
        });
      }
    }
    for (const player of resolved.players) {
      let playerId = player.playerId;
      if (player.create !== null) {
        const { primaryPosition, ...person } = player.create;
        const personId = at(ids, `person:${side}:${player.shirtNumber}`);
        playerId = at(ids, `player:${side}:${player.shirtNumber}`);
        persons.push({ id: personId, ...person });
        players.push({ id: playerId, personId, primaryPosition });
      }
      if (player.registrationId === null) {
        registrations.push({
          id: at(ids, `registration:${side}:${player.shirtNumber}`),
          participationId,
          playerId: settled(playerId, `Player "${player.printed}"`),
        });
      }
    }
  }
  matched.officials.forEach((official, index) => {
    if (official.create !== null) {
      persons.push({ id: at(ids, `person:official:${index}`), ...official.create });
    }
  });

  return { teams, participations, teamAliases, teamSourceIds, persons, players, registrations };
};

export const matchRecords = (
  report: MatchReport,
  normalized: NormalizedReport,
  matched: Matched,
  ids: Ids,
): MatchRecords => {
  const entryOf = (side: Side, name: PersonName) => {
    const key = normalizeName(`${name.familyName} ${name.givenName}`);
    return sideOf(normalized, side).players.find((player) => player.name.key === key);
  };
  const lineupId = (side: Side) => at(ids, `lineup:${side}`);

  // The page prints local wall-clock time; the match keeps the instant.
  const kickoff = DateTime.makeZonedUnsafe(`${report.kickoff.date}T${report.kickoff.time}:00`, {
    timeZone: report.kickoff.timezone,
    adjustForTimeZone: true,
  });

  return {
    match: {
      id: at(ids, 'match'),
      editionId: settled(matched.editionId, 'The edition'),
      roundId: settled(matched.roundId, 'The round'),
      homeParticipationId: participationOf(matched, ids, 'HOME'),
      awayParticipationId: participationOf(matched, ids, 'AWAY'),
      status: 'FINISHED',
      number: report.source.matchNumber,
      kickoffAt: DateTime.formatIso(kickoff),
      timezone: report.kickoff.timezone,
      venue: report.venue,
      // The page does not say whether extra time was played.
      durationMinutes: null,
      homeScore: report.fullTimeScore.home,
      awayScore: report.fullTimeScore.away,
      homeHalfTimeScore: report.halfTimeScore?.home ?? null,
      awayHalfTimeScore: report.halfTimeScore?.away ?? null,
      homePenaltyScore: report.penaltyShootout?.home ?? null,
      awayPenaltyScore: report.penaltyShootout?.away ?? null,
      attendance: report.attendance,
    },
    lineups: sides.map((side) => ({
      id: lineupId(side),
      participationId: participationOf(matched, ids, side),
    })),
    lineupEntries: sides.flatMap((side) =>
      sideOf(normalized, side).players.map((player) => ({
        id: at(ids, `entry:${side}:${player.shirtNumber}`),
        lineupId: lineupId(side),
        registrationId: registrationOf(matched, ids, side, player.shirtNumber),
        role: player.role,
        shirtNumber: player.shirtNumber,
        isStartingCaptain: player.isStartingCaptain,
      })),
    ),
    // An own goal is credited to the other side, so its scorer is on the
    // other side's sheet. A scorer missing from the sheet leaves the goal
    // unattributed, which the record allows.
    goals: report.goals.map((goal, index) => {
      const sheetSide = goal.kind === 'OWN_GOAL' ? opposite(goal.side) : goal.side;
      const entry = entryOf(sheetSide, goal.scorer);
      return {
        id: at(ids, `goal:${index}`),
        participationId: participationOf(matched, ids, goal.side),
        registrationId:
          entry === undefined ? null : registrationOf(matched, ids, sheetSide, entry.shirtNumber),
        kind: goal.kind,
        minute: goal.at.minute,
        stoppageMinute: goal.at.stoppageMinute,
      };
    }),
    cards: report.cards.map((card, index) => {
      const entry = entryOf(card.side, card.player);
      if (entry === undefined) {
        throw new Error(
          `Booked player "${card.player.familyName} ${card.player.givenName}" is not on the ${card.side.toLowerCase()} team sheet`,
        );
      }
      return {
        id: at(ids, `card:${index}`),
        participationId: participationOf(matched, ids, card.side),
        registrationId: registrationOf(matched, ids, card.side, entry.shirtNumber),
        kind: card.kind,
        minute: card.at.minute,
        stoppageMinute: card.at.stoppageMinute,
      };
    }),
    substitutions: normalized.substitutions.map((substitution, index) => ({
      id: at(ids, `substitution:${index}`),
      participationId: participationOf(matched, ids, substitution.side),
      outgoingRegistrationId: registrationOf(
        matched,
        ids,
        substitution.side,
        substitution.outgoingShirtNumber,
      ),
      incomingRegistrationId: registrationOf(
        matched,
        ids,
        substitution.side,
        substitution.incomingShirtNumber,
      ),
      minute: substitution.at.minute,
      stoppageMinute: substitution.at.stoppageMinute,
    })),
    crewAssignments: matched.officials.map((official, index) => ({
      id: at(ids, `crew:${index}`),
      personId: official.personId ?? at(ids, `person:official:${index}`),
      role: official.role,
    })),
  };
};
