import { parseFacrMatchPage } from '#Facr';
import page from '../fixtures/facr-match.html?raw';
import visitorGoalPage from '../fixtures/facr-match-visitor-goal.html?raw';
import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vite-plus/test';

// The saved page of SK Slavia Praha - FC Viktoria Plzeň, FORTUNA LIGA 2026/27,
// 1st round, as fotbal.cz rendered it on 2026-09-02.
const report = Effect.runSync(parseFacrMatchPage(page));

const names = (entries: ReadonlyArray<{ name: { familyName: string; givenName: string } }>) =>
  entries.map(({ name }) => `${name.familyName} ${name.givenName}`);

describe('parseFacrMatchPage', () => {
  it('reads the header, the teams and the result', () => {
    expect(report.source).toEqual({ provider: 'FACR', matchNumber: '2026005J1A0104' });
    expect(report.competition).toEqual({ name: 'FORTUNA LIGA', sex: 'FEMALE' });
    expect(report.round).toEqual({ name: '1.kolo', position: 1 });
    expect(report.kickoff).toEqual({
      date: '2026-08-15',
      time: '12:15',
      timezone: 'Europe/Prague',
    });
    expect(report.home.name).toBe('SK Slavia Praha');
    expect(report.home.sourceId).toBe('f8a99ee8-94fa-483b-b1f8-78b7a8c4a0ac');
    expect(report.away.name).toBe('FC Viktoria Plzeň');
    expect(report.away.sourceId).toBe('0bffbad2-02bd-46f7-a570-3b7b136d5174');
    expect(report.fullTimeScore).toEqual({ home: 8, away: 0 });
    expect(report.halfTimeScore).toEqual({ home: 4, away: 0 });
    expect(report.venue).toBe('Horní Měcholupy - tráva');
    expect(report.attendance).toBe(360);
  });

  it('reads the goals with their side from the timeline', () => {
    expect(report.goals.map((goal) => goal.at.minute)).toEqual([11, 17, 43, 45, 59, 66, 85, 90]);
    expect(report.goals.every((goal) => goal.side === 'HOME' && goal.kind === 'REGULAR')).toBe(
      true,
    );
    expect(report.goals[2]?.scorer).toEqual({ familyName: 'Korsun', givenName: 'Kateryna' });
  });

  it('reads the officials from the details line', () => {
    expect(report.officials).toEqual([
      { role: 'REFEREE', name: { familyName: 'Hrušková', givenName: 'Katka' } },
      { role: 'ASSISTANT_REFEREE', name: { familyName: 'Brzková', givenName: 'Adéla' } },
      { role: 'ASSISTANT_REFEREE', name: { familyName: 'Brzková', givenName: 'Valentýna' } },
      { role: 'DELEGATE', name: { familyName: 'Svoboda', givenName: 'Miroslav' } },
    ]);
  });

  it('reads both team sheets row by row', () => {
    expect(report.home.entries).toHaveLength(19);
    expect(report.away.entries).toHaveLength(15);
    expect(report.home.entries.filter((entry) => entry.role === 'STARTER')).toHaveLength(11);
    expect(report.away.entries.filter((entry) => entry.role === 'SUBSTITUTE')).toHaveLength(4);
    expect(report.home.entries[0]).toEqual({
      name: { familyName: 'Votíková', givenName: 'Barbora' },
      shirtNumber: 33,
      role: 'STARTER',
      isGoalkeeper: true,
      isStartingCaptain: false,
    });
    expect(names(report.home.entries.filter((entry) => entry.isStartingCaptain))).toEqual([
      'Bendová Lucie',
    ]);
    expect(names(report.away.entries.filter((entry) => entry.isGoalkeeper))).toEqual([
      'Radová Michaela',
      'Žížková Natálie',
    ]);
    expect(report.home.entries.find((entry) => entry.shirtNumber === 32)?.name).toEqual({
      familyName: 'Sobotková',
      givenName: 'Gabriela Jana',
    });
    expect(report.cards).toEqual([]);
  });

  it('reads substitutions from the counterpart each row names', () => {
    expect(report.substitutions).toHaveLength(7);
    expect(report.substitutions.filter((s) => s.side === 'HOME')).toHaveLength(5);
    expect(report.substitutions).toContainEqual({
      side: 'HOME',
      outgoing: { familyName: 'Jelínková', givenName: 'Lucie' },
      incoming: { familyName: 'Korsun', givenName: 'Kateryna' },
      at: { minute: 37, stoppageMinute: null },
    });
    expect(report.substitutions).toContainEqual({
      side: 'HOME',
      outgoing: { familyName: 'Kravchuk', givenName: 'Roksolana' },
      incoming: { familyName: 'Pennock', givenName: 'Sierra' },
      at: { minute: 46, stoppageMinute: null },
    });
    expect(report.substitutions).toContainEqual({
      side: 'AWAY',
      outgoing: { familyName: 'Zomberová', givenName: 'Adéla' },
      incoming: { familyName: 'Tvrdíková', givenName: 'Kristýna' },
      at: { minute: 87, stoppageMinute: null },
    });
  });

  it('refuses a page without a match', () => {
    const outcome = Effect.runSync(Effect.flip(parseFacrMatchPage('<html><body>Hi</body></html>')));
    expect(outcome._tag).toBe('NotAMatchPageError');
  });

  it('refuses a match whose timeline does not add up, saying why', () => {
    const broken = page.replace(
      '<strong class="H3"> 8:0 </strong>',
      '<strong class="H3"> 7:0 </strong>',
    );
    const outcome = Effect.runSync(Effect.flip(parseFacrMatchPage(broken)));
    expect(outcome._tag).toBe('MatchReportParseError');
    expect(outcome._tag === 'MatchReportParseError' ? outcome.findings : []).toEqual([
      'the timeline has 8:0 goals but the score is 7:0',
    ]);
  });
});

// The saved page of ABC Braník - SK Sigma Olomouc, 2. liga žen 2026/27, 4th
// round, as fotbal.cz rendered it on 2026-09-06: a visitor goal on the timeline
// and a second yellow card, printed as a yellow and a red at the same minute.
const visitorPage = Effect.runSync(parseFacrMatchPage(visitorGoalPage));

describe('parseFacrMatchPage, a page with a visitor goal and a second yellow', () => {
  it('reads the visitor goal with its side', () => {
    expect(visitorPage.fullTimeScore).toEqual({ home: 4, away: 1 });
    expect(visitorPage.goals.filter((goal) => goal.side === 'AWAY')).toEqual([
      {
        side: 'AWAY',
        scorer: { familyName: 'Keňová', givenName: 'Alena' },
        kind: 'REGULAR',
        at: { minute: 49, stoppageMinute: null },
      },
    ]);
  });

  it('reads a yellow and a red at one minute as a second yellow', () => {
    const player = { familyName: 'Boháčová', givenName: 'Natálie' };
    expect(visitorPage.cards.filter((card) => card.player.familyName === 'Boháčová')).toEqual([
      { side: 'HOME', player, kind: 'YELLOW', at: { minute: 56, stoppageMinute: null } },
      { side: 'HOME', player, kind: 'SECOND_YELLOW', at: { minute: 75, stoppageMinute: null } },
    ]);
    expect(visitorPage.cards.some((card) => card.kind === 'RED')).toBe(false);
  });
});

describe('parseFacrMatchPage, a tie decided on penalties', () => {
  // A shoot-out is printed before the half-time score, and the result as a
  // 1:0 win for the side that won it, whatever the timeline says.
  const decided = visitorGoalPage
    .replace(/<strong class="H3">\s*4:1\s*<\/strong>/, '<strong class="H3"> 0:1 </strong>')
    .replace('(4:0)', 'Pen: 3:4 (0:0)')
    .replace(
      /<li[^>]*class="MatchTimeline-item MatchTimeline-item--(?:home|visitor)"[\s\S]*?<\/li>/g,
      '',
    );
  const report = Effect.runSync(parseFacrMatchPage(decided));

  it('keeps the score after play and reads the shoot-out', () => {
    expect(report.goals).toEqual([]);
    expect(report.fullTimeScore).toEqual({ home: 0, away: 0 });
    expect(report.halfTimeScore).toEqual({ home: 0, away: 0 });
    expect(report.penaltyShootout).toEqual({ home: 3, away: 4 });
  });

  it('reads a goal marked "(penalta)" as a penalty', () => {
    const marked = visitorGoalPage.replace('<p>Keňová Alena</p>', '<p>Keňová Alena (penalta)</p>');
    const goals = Effect.runSync(parseFacrMatchPage(marked)).goals;
    expect(goals.find((goal) => goal.side === 'AWAY')?.kind).toBe('PENALTY');
  });

  it('refuses a shoot-out whose printed result names the wrong side', () => {
    const wrong = decided.replace(
      '<strong class="H3"> 0:1 </strong>',
      '<strong class="H3"> 1:0 </strong>',
    );
    const outcome = Effect.runSync(Effect.flip(parseFacrMatchPage(wrong)));
    expect(outcome._tag === 'MatchReportParseError' ? outcome.findings : []).toEqual([
      'the timeline has 0:0 goals and the shoot-out 3:4, but the score is 1:0',
    ]);
  });
});

describe('parseFacrMatchPage, an official with an academic title', () => {
  it('drops the title printed after the comma', () => {
    const titled = visitorGoalPage.replace(
      /(<strong>Rozhodčí:<\/strong>[^–]*–\s*)([^,<]+),/,
      '$1Došek, Ing. Jiří,',
    );
    const report = Effect.runSync(parseFacrMatchPage(titled));
    expect(report.officials.filter((o) => o.role === 'ASSISTANT_REFEREE')[0]?.name).toEqual({
      familyName: 'Došek',
      givenName: 'Jiří',
    });
  });
});
