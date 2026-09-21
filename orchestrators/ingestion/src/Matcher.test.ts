import type { MatchReport } from '#MatchReport';
import { applicableDecisions, matchReport } from '#Matcher';
import { normalizeReport } from '#Normalizer';
import { catalogRecords, matchRecords, recordLabels } from '#Records';
import type { ReviewDecision } from '@skoreon/api-gateway-contract/Matches';
import type { EditionOnDate, FoundPerson } from '@skoreon/catalog-service/rpcs';
import { describe, expect, it } from 'vite-plus/test';

const entry = (
  shirtNumber: number,
  familyName: string,
  givenName: string,
  rest: Partial<MatchReport['home']['entries'][number]> = {},
): MatchReport['home']['entries'][number] => ({
  name: { familyName, givenName },
  shirtNumber,
  role: 'STARTER',
  isGoalkeeper: false,
  isStartingCaptain: false,
  ...rest,
});

const at = (minute: number) => ({ minute, stoppageMinute: null });

const report: MatchReport = {
  source: { provider: 'FACR', matchNumber: '2026001A1A0101' },
  competition: { name: 'FORTUNA LIGA', sex: 'FEMALE' },
  round: { name: '1.kolo', position: 1 },
  kickoff: { date: '2026-08-15', time: '12:15', timezone: 'Europe/Prague' },
  venue: 'Eden',
  attendance: 1200,
  fullTimeScore: { home: 2, away: 1 },
  halfTimeScore: { home: 1, away: 0 },
  penaltyShootout: null,
  home: {
    name: 'Slavia Praha',
    sourceId: 'club-slavia',
    entries: [
      entry(1, 'Nováková', 'Jana', { isGoalkeeper: true, isStartingCaptain: true }),
      entry(7, 'Svobodová', 'Eva'),
      entry(12, 'Králová', 'Anna', { role: 'SUBSTITUTE' }),
    ],
  },
  away: {
    name: 'Sparta Praha',
    sourceId: 'club-sparta',
    entries: [
      entry(1, 'Dvořáková', 'Petra', { isGoalkeeper: true }),
      entry(9, 'Horáková', 'Lucie'),
      entry(14, 'Malá', 'Tereza', { role: 'SUBSTITUTE' }),
    ],
  },
  goals: [
    {
      side: 'HOME',
      scorer: { familyName: 'Svobodová', givenName: 'Eva' },
      kind: 'REGULAR',
      at: at(20),
    },
    {
      side: 'HOME',
      scorer: { familyName: 'Dvořáková', givenName: 'Petra' },
      kind: 'OWN_GOAL',
      at: at(75),
    },
    {
      side: 'AWAY',
      scorer: { familyName: 'Malá', givenName: 'Tereza' },
      kind: 'PENALTY',
      at: at(88),
    },
  ],
  cards: [
    {
      side: 'AWAY',
      player: { familyName: 'Horáková', givenName: 'Lucie' },
      kind: 'YELLOW',
      at: at(30),
    },
  ],
  substitutions: [
    {
      side: 'HOME',
      outgoing: { familyName: 'Svobodová', givenName: 'Eva' },
      incoming: { familyName: 'Králová', givenName: 'Anna' },
      at: at(60),
    },
    {
      side: 'AWAY',
      outgoing: { familyName: 'Horáková', givenName: 'Lucie' },
      incoming: { familyName: 'Malá', givenName: 'Tereza' },
      at: at(70),
    },
  ],
  officials: [{ role: 'REFEREE', name: { familyName: 'Novák', givenName: 'Jan' } }],
};

const registration = (id: string, playerId: string, familyName: string, givenName: string) => ({
  id,
  player: { id: playerId, person: { givenName, familyName } },
});

const editions: Array<EditionOnDate> = [
  {
    id: 'E',
    startsOn: '2026-08-01',
    endsOn: '2027-05-31',
    competition: { id: 'C', code: 'FL', name: 'Fortuna liga' },
    phases: [
      {
        id: 'P',
        name: 'Main',
        format: 'LEAGUE',
        role: 'MAIN',
        startsOn: '2026-08-01',
        endsOn: '2027-05-31',
        rounds: [
          { id: 'R1', name: '1. kolo', position: 1 },
          { id: 'R2', name: '2. kolo', position: 2 },
        ],
      },
    ],
    participations: [
      {
        id: 'PH',
        // Spelled differently from the page, but the club is known by its identifier.
        team: {
          id: 'TH',
          name: 'SK Slavia Praha',
          aliases: [],
          sourceIds: [{ source: 'FACR', externalId: 'club-slavia' }],
        },
        registrations: [registration('REG-H1', 'PL-H1', 'Nováková', 'Jana')],
      },
      {
        id: 'PA',
        team: { id: 'TA', name: 'AC Sparta Praha', aliases: [], sourceIds: [] },
        registrations: [
          registration('REG-A1', 'PL-A1', 'Dvořáková', 'Petra'),
          registration('REG-A9', 'PL-A9', 'Horáková', 'Lucie'),
          registration('REG-A14', 'PL-A14', 'Malá', 'Tereza'),
        ],
      },
    ],
  },
];

const persons: Array<FoundPerson> = [
  { id: 'PER-7', givenName: 'Eva', familyName: 'Svobodová', players: [{ id: 'PL-7' }] },
  { id: 'PER-REF', givenName: 'Jan', familyName: 'Novák', players: [] },
];

const normalized = normalizeReport(report);

const decisions: Array<ReviewDecision> = [
  { kind: 'TEAM', side: 'AWAY', printed: 'Sparta Praha', candidateId: 'PA' },
  { kind: 'PLAYER', side: 'HOME', printed: 'Svobodová Eva', candidateId: 'PL-7' },
  {
    kind: 'PLAYER',
    side: 'HOME',
    printed: 'Králová Anna',
    create: {
      givenName: 'Anna',
      familyName: 'Králová',
      sex: 'FEMALE',
      dateOfBirth: '2004-03-09',
      nationality: 'CZE',
      primaryPosition: 'FORWARD',
    },
  },
];

describe('normalizeReport', () => {
  it('turns substitutions into shirt numbers', () => {
    expect(normalized.substitutions).toEqual([
      { side: 'HOME', outgoingShirtNumber: 7, incomingShirtNumber: 12, at: at(60) },
      { side: 'AWAY', outgoingShirtNumber: 9, incomingShirtNumber: 14, at: at(70) },
    ]);
  });
});

describe('matchReport', () => {
  const first = matchReport(normalized, editions, persons);

  it('settles what matches exactly once, teams by identifier before spelling', () => {
    expect(first.editionId).toBe('E');
    expect(first.roundId).toBe('R1');
    expect(first.home.participationId).toBe('PH');
    expect(first.home.players[0]).toMatchObject({ registrationId: 'REG-H1', playerId: 'PL-H1' });
    expect(first.officials[0]?.personId).toBe('PER-REF');
    expect(first.away.participationId).toBeNull();
    expect(first.away.players.every((player) => player.registrationId === null)).toBe(true);
  });

  it('lists the rest with candidates and what creating would take', () => {
    expect(first.unmatched.map(({ kind, side, printed }) => ({ kind, side, printed }))).toEqual([
      { kind: 'PLAYER', side: 'HOME', printed: 'Svobodová Eva' },
      { kind: 'PLAYER', side: 'HOME', printed: 'Králová Anna' },
      { kind: 'TEAM', side: 'AWAY', printed: 'Sparta Praha' },
    ]);
    const [known, unknown, team] = first.unmatched;
    expect(team?.creation).toEqual({ name: 'Sparta Praha', establishedOn: null });
    expect(known?.candidates).toEqual([{ id: 'PL-7', name: 'Svobodová Eva', registered: false }]);
    expect(unknown?.candidates).toEqual([]);
    expect(unknown?.creation).toEqual({
      givenName: 'Anna',
      familyName: 'Králová',
      sex: 'FEMALE',
      dateOfBirth: null,
      nationality: null,
      primaryPosition: null,
    });
  });

  it('applies decisions and keeps a creation as the reviewer spelled it', () => {
    const settled = matchReport(normalized, editions, persons, decisions);
    expect(settled.unmatched).toEqual([]);
    expect(settled.away.participationId).toBe('PA');
    expect(settled.away.players.map((player) => player.registrationId)).toEqual([
      'REG-A1',
      'REG-A9',
      'REG-A14',
    ]);
    expect(settled.home.players[1]).toMatchObject({ registrationId: null, playerId: 'PL-7' });
    expect(settled.home.players[2]).toMatchObject({
      registrationId: null,
      playerId: null,
      create: { dateOfBirth: '2004-03-09', primaryPosition: 'FORWARD' },
    });
  });

  it('keeps only decisions that answer what was listed', () => {
    const stray: Array<ReviewDecision> = [
      { kind: 'TEAM', side: 'AWAY', printed: 'Sparta Praha', candidateId: 'nobody' },
      { kind: 'PLAYER', side: 'AWAY', printed: 'Svobodová Eva', candidateId: 'PL-7' },
      {
        kind: 'TEAM',
        side: 'HOME',
        printed: 'Slavia Praha',
        create: { name: 'X', establishedOn: '1892-11-02' },
      },
    ];
    expect(applicableDecisions(first.unmatched, [...decisions, ...stray])).toEqual(decisions);
  });
});

describe('records', () => {
  const matched = matchReport(normalized, editions, persons, decisions);
  const ids = Object.fromEntries(
    recordLabels(report, normalized, matched).map((label) => [label, `id:${label}`]),
  );

  it('creates only what is missing, with the identifiers allocated for it', () => {
    const catalog = catalogRecords(normalized, matched, ids);
    expect(catalog.teams).toEqual([]);
    expect(catalog.teamSourceIds).toEqual([]);
    expect(catalog.persons).toEqual([
      {
        id: 'id:person:HOME:12',
        givenName: 'Anna',
        familyName: 'Králová',
        sex: 'FEMALE',
        dateOfBirth: '2004-03-09',
        nationality: 'CZE',
      },
    ]);
    expect(catalog.players).toEqual([
      { id: 'id:player:HOME:12', personId: 'id:person:HOME:12', primaryPosition: 'FORWARD' },
    ]);
    expect(catalog.registrations).toEqual([
      { id: 'id:registration:HOME:7', participationId: 'PH', playerId: 'PL-7' },
      { id: 'id:registration:HOME:12', participationId: 'PH', playerId: 'id:player:HOME:12' },
    ]);
  });

  it('creates a team with its alias and source identifier, and its players with it', () => {
    const newPlayer = (familyName: string, givenName: string): ReviewDecision => ({
      kind: 'PLAYER',
      side: 'AWAY',
      printed: `${familyName} ${givenName}`,
      create: {
        givenName,
        familyName,
        sex: 'FEMALE',
        dateOfBirth: '2000-01-01',
        nationality: 'CZE',
        primaryPosition: 'DEFENDER',
      },
    });
    const created = matchReport(normalized, editions, persons, [
      ...decisions.filter((decision) => decision.kind !== 'TEAM'),
      {
        kind: 'TEAM',
        side: 'AWAY',
        printed: 'Sparta Praha',
        create: { name: 'AC Sparta Praha B', establishedOn: '1893-11-16' },
      },
      newPlayer('Dvořáková', 'Petra'),
      newPlayer('Horáková', 'Lucie'),
      newPlayer('Malá', 'Tereza'),
    ]);
    expect(created.unmatched).toEqual([]);
    const labels = recordLabels(report, normalized, created);
    const catalog = catalogRecords(
      normalized,
      created,
      Object.fromEntries(labels.map((label) => [label, `id:${label}`])),
    );
    expect(catalog.teams).toEqual([
      {
        id: 'id:team:AWAY',
        kind: 'CLUB',
        country: 'CZE',
        name: 'AC Sparta Praha B',
        establishedOn: '1893-11-16',
      },
    ]);
    expect(catalog.teamAliases).toEqual([
      { id: 'id:alias:AWAY', teamId: 'id:team:AWAY', source: 'FACR', name: 'Sparta Praha' },
    ]);
    expect(catalog.teamSourceIds).toEqual([
      {
        id: 'id:sourceId:AWAY',
        teamId: 'id:team:AWAY',
        source: 'FACR',
        externalId: 'club-sparta',
      },
    ]);
    expect(catalog.participations).toEqual([
      { id: 'id:participation:AWAY', editionId: 'E', teamId: 'id:team:AWAY' },
    ]);
    expect(
      catalog.registrations.filter((r) => r.participationId === 'id:participation:AWAY'),
    ).toHaveLength(3);
  });

  it('lays the match out over existing and allocated identifiers alike', () => {
    const match = matchRecords(report, normalized, matched, ids);
    expect(match.match).toMatchObject({
      id: 'id:match',
      editionId: 'E',
      roundId: 'R1',
      homeParticipationId: 'PH',
      awayParticipationId: 'PA',
      number: '2026001A1A0101',
      kickoffAt: '2026-08-15T10:15:00.000Z',
      homeScore: 2,
      awayScore: 1,
    });
    expect(match.lineupEntries.map(({ registrationId }) => registrationId)).toEqual([
      'REG-H1',
      'id:registration:HOME:7',
      'id:registration:HOME:12',
      'REG-A1',
      'REG-A9',
      'REG-A14',
    ]);
    expect(match.lineupEntries[0]).toMatchObject({ shirtNumber: 1, isStartingCaptain: true });
    // The own goal is the home side's, scored by an away player.
    expect(
      match.goals.map(({ participationId, registrationId }) => [participationId, registrationId]),
    ).toEqual([
      ['PH', 'id:registration:HOME:7'],
      ['PH', 'REG-A1'],
      ['PA', 'REG-A14'],
    ]);
    expect(match.cards[0]).toMatchObject({ participationId: 'PA', registrationId: 'REG-A9' });
    expect(
      match.substitutions.map((s) => [s.outgoingRegistrationId, s.incomingRegistrationId]),
    ).toEqual([
      ['id:registration:HOME:7', 'id:registration:HOME:12'],
      ['REG-A9', 'REG-A14'],
    ]);
    expect(match.crewAssignments).toEqual([
      { id: 'id:crew:0', personId: 'PER-REF', role: 'REFEREE' },
    ]);
  });
});
