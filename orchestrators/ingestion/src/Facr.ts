import type { LineupRole, Side } from '#Enums';
import { MatchReportParseError, NotAMatchPageError } from '#Errors';
import { children, find, findAll, hasClass, parseHtml, textOf } from '#Html';
import type {
  Card,
  Goal,
  MatchReport,
  PersonName,
  Substitution,
  TeamSheetEntry,
} from '#MatchReport';
import * as Effect from 'effect/Effect';

// Reads a FAČR match page (fotbal.cz) by its markup. The page is generated,
// so every fact sits in a known place: the header carries kickoff, round and
// competition; each team is a link to its club; the timeline lists goals
// with their side in a class; the details paragraph labels number, officials,
// venue and attendance; each team sheet is a table whose substitution cell
// names the counterpart. Nothing is transcribed, so nothing can be invented:
// what the page does not say is null, and a page that does not fit is
// refused with what did not fit.

const timezone = 'Europe/Prague';
const womensBreadcrumb = 'Soutěže žen';
const clubLink = /\/club\/club\/([0-9a-f-]{36})/;
// "15. 8. 2026 12:15, 1.kolo, FORTUNA LIGA"
const meta = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{1,2}):(\d{2}),\s*([^,]+),\s*(.+)$/;
const ordinal = /^(\d+)\s*\./;
const scoreMark = /^(\d+):(\d+)$/;
const halfTimeMark = /^(?:Pen: (\d+):(\d+) )?\((\d+):(\d+)\)$/;
const minuteMark = /^(\d+)\.?$/;
const captainMark = /\s*\[K\]$/;
const scorerMark = /^(.*?)\s*(?:\(([^)]*)\))?$/;
const officialsSplit = /\s[-–]\s/;
// An official's academic title is printed after a comma, "Došek, Ing. Jiří";
// the title is not part of the name.
const academicTitle = /,\s*(?:(?:Ing|Mgr|Bc|Dr|MUDr|JUDr|PhDr|RNDr|PaedDr|MgA|BcA|Ph\.D)\.\s*)+/g;

// How FAČR marks a goal that is not a regular one, in parentheses after the
// scorer. Provisional: read off the site's conventions, not yet seen on a
// saved page; an unknown mark is a finding, not a regular goal.
const goalMarks: Record<string, Goal['kind']> = {
  'vl.': 'OWN_GOAL',
  vlastní: 'OWN_GOAL',
  'pen.': 'PENALTY',
  'p.': 'PENALTY',
  penalta: 'PENALTY',
};

const pad = (value: string): string => value.padStart(2, '0');

const opposite = (side: Side): Side => (side === 'HOME' ? 'AWAY' : 'HOME');

// A change read off one row: this player and the one named in the cell's
// title changed places at the minute printed.
interface Change {
  readonly side: Side;
  readonly player: PersonName;
  readonly counterpart: string;
  readonly minute: number;
  readonly role: LineupRole;
}

export const parseFacrMatchPage = (
  html: string,
): Effect.Effect<MatchReport, NotAMatchPageError | MatchReportParseError> => {
  const root = parseHtml(html);
  const article = find(root, (element) => element.tag === 'article' && hasClass(element, 'Match'));
  if (article === undefined) {
    return Effect.fail(new NotAMatchPageError({ message: 'The page has no match article' }));
  }

  const findings: Array<string> = [];
  const note = (finding: string) => findings.push(finding);

  // FAČR prints the family name first, then the given name or names.
  const personName = (printed: string, what: string): PersonName => {
    const [familyName, ...given] = printed.split(' ');
    if (familyName === undefined || given.length === 0) note(`${what} "${printed}" is not a name`);
    return { familyName: familyName ?? '', givenName: given.join(' ') };
  };

  // Header: kickoff, round and competition.
  const heading = find(article, (element) => hasClass(element, 'Match-meta'));
  const header = meta.exec(heading === undefined ? '' : textOf(heading));
  if (header === null)
    note(
      `the header "${heading === undefined ? '' : textOf(heading)}" is not kickoff, round and competition`,
    );
  const [
    ,
    day = '',
    month = '',
    year = '',
    hour = '',
    minute = '',
    roundName = '',
    competitionName = '',
  ] = header ?? [];
  const position = ordinal.exec(roundName);

  // Teams: a link to each club, home first.
  const teamLinks = findAll(article, (element) => hasClass(element, 'Match-team')).map((team) =>
    find(team, (element) => element.tag === 'a' && hasClass(element, 'Link--stretched')),
  );
  if (teamLinks.length !== 2) note(`the page names ${teamLinks.length} teams, not two`);
  const team = (index: number) => {
    const link = teamLinks[index];
    return {
      name: link === undefined ? '' : textOf(link),
      sourceId:
        link === undefined ? null : (clubLink.exec(link.attributes['href'] ?? '')?.[1] ?? null),
    };
  };
  const teams = { HOME: team(0), AWAY: team(1) };

  // Result: the full-time score, and the half-time score under it.
  const result = find(article, (element) => hasClass(element, 'Match-result'));
  const scoreText =
    result === undefined ? '' : textOf(find(result, (element) => element.tag === 'strong') ?? '');
  const score = scoreMark.exec(scoreText);
  if (score === null) note(`the result "${scoreText}" is not a score`);
  const halfTimeElement =
    result === undefined ? undefined : find(result, (element) => element.tag === 'p');
  const halfTimeText = halfTimeElement === undefined ? '' : textOf(halfTimeElement);
  const halfTime = halfTimeMark.exec(halfTimeText);
  if (halfTimeText !== '' && halfTime === null) note(`"${halfTimeText}" is not a half-time score`);
  // A tie decided on penalties prints "Pen: 4:3" before the half-time score,
  // and the result as a 1:0 win for the side that won the shoot-out; the
  // score after play is what the timeline adds up to.
  const shootout =
    halfTime?.[1] === undefined ? null : { home: Number(halfTime[1]), away: Number(halfTime[2]) };

  // Timeline: goals, each on the side its class says.
  const timeline = find(
    article,
    (element) => element.tag === 'ol' && hasClass(element, 'MatchTimeline'),
  );
  const goals: Array<Goal> = (timeline === undefined ? [] : children(timeline))
    .filter((item) => hasClass(item, 'MatchTimeline-item'))
    .flatMap((item): Array<Goal> => {
      const side: Side | null = hasClass(item, 'MatchTimeline-item--home')
        ? 'HOME'
        : hasClass(item, 'MatchTimeline-item--visitor')
          ? 'AWAY'
          : null;
      const scorerText = textOf(find(item, (element) => element.tag === 'p') ?? '');
      const minuteText = textOf(find(item, (element) => element.tag === 'strong') ?? '');
      const [, printed = '', mark] = scorerMark.exec(scorerText) ?? [];
      const at = minuteMark.exec(minuteText);
      if (side === null) note(`goal "${scorerText}" has no side`);
      if (at === null) note(`goal "${scorerText}" has no minute, "${minuteText}"`);
      const kind = mark === undefined ? 'REGULAR' : goalMarks[mark.trim().toLowerCase()];
      if (kind === undefined)
        note(`goal "${scorerText}" carries a mark "(${mark})" the reader does not know`);
      return [
        {
          side: side ?? 'HOME',
          scorer: personName(printed, 'scorer'),
          kind: kind ?? 'REGULAR',
          at: { minute: at === null ? 0 : Number(at[1]), stoppageMinute: null },
        },
      ];
    });

  // Details: labelled values in one paragraph, "Label: value." in turn.
  const details = new Map<string, string>();
  const paragraph = find(article, (element) => hasClass(element, 'Match-detailsContainer'));
  let label: string | null = null;
  for (const node of (paragraph === undefined
    ? undefined
    : find(paragraph, (element) => element.tag === 'p')
  )?.children ?? []) {
    if (typeof node === 'string') {
      if (label !== null) details.set(label, `${details.get(label) ?? ''}${node}`);
    } else if (node.tag === 'strong') {
      label = textOf(node).replace(/:$/, '');
    } else if (label !== null) {
      details.set(label, `${details.get(label) ?? ''}${textOf(node)}`);
    }
  }
  const detail = (name: string): string | null => {
    const value = details.get(name)?.replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
    return value === undefined || value === '' ? null : value;
  };
  const attendance = detail('Diváků');
  if (attendance !== null && !/^\d+$/.test(attendance))
    note(`attendance "${attendance}" is not a number`);
  const [refereeText = '', assistantsText = ''] = (detail('Rozhodčí') ?? '')
    .replace(academicTitle, ' ')
    .split(officialsSplit, 2);
  const officials: MatchReport['officials'] = [
    ...(refereeText === ''
      ? []
      : [{ role: 'REFEREE' as const, name: personName(refereeText.trim(), 'referee') }]),
    ...assistantsText
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '')
      .map((name) => ({
        role: 'ASSISTANT_REFEREE' as const,
        name: personName(name, 'assistant referee'),
      })),
    ...(detail('Delegát') === null
      ? []
      : [{ role: 'DELEGATE' as const, name: personName(detail('Delegát')!, 'delegate') }]),
  ];

  // Team sheets: one section per team, a table of starters and one of
  // substitutes under their own header, each row a player with cards and
  // the change the row's last cell names.
  const grid = find(article, (element) => hasClass(element, 'Match-statsGrid'));
  const sections = grid === undefined ? [] : findAll(grid, (element) => element.tag === 'section');
  if (sections.length !== 2) note(`the page has ${sections.length} team sheets, not two`);
  const cards: Array<Card> = [];
  const changes: Array<Change> = [];
  const sheet = (side: Side) => {
    const section = sections[side === 'HOME' ? 0 : 1];
    const entries: Array<TeamSheetEntry> = [];
    if (section === undefined) return { ...teams[side], entries };
    const heading = textOf(find(section, (element) => element.tag === 'h2') ?? '');
    if (heading !== teams[side].name) {
      note(
        `the ${side.toLowerCase()} team sheet is headed "${heading}", the team is "${teams[side].name}"`,
      );
    }
    const table = find(section, (element) => element.tag === 'table');
    let role: LineupRole | null = null;
    for (const block of table === undefined ? [] : children(table)) {
      if (block.tag === 'thead') {
        const title = textOf(children(children(block)[0] ?? block)[2] ?? '');
        role = title === 'Jméno' ? 'STARTER' : title === 'Náhradníci' ? 'SUBSTITUTE' : null;
        if (role === null)
          note(`a team sheet block is headed "${title}", neither players nor substitutes`);
        continue;
      }
      if (block.tag !== 'tbody') continue;
      for (const row of children(block).filter((element) => element.tag === 'tr')) {
        const cells = children(row).filter((element) => element.tag === 'td');
        const [number = '', letter = '', nameCell = '', yellow = '', red = '', change] = cells.map(
          (cell) => cell,
        );
        const [numberText, letterText, nameText, yellowText, redText] = [
          number,
          letter,
          nameCell,
          yellow,
          red,
        ].map((cell) => (typeof cell === 'string' ? cell : textOf(cell)));
        if (!/^\d+$/.test(numberText!))
          note(
            `a ${side.toLowerCase()} team sheet row starts with "${numberText}", not a shirt number`,
          );
        const isStartingCaptain = captainMark.test(nameText!);
        const name = personName(nameText!.replace(captainMark, ''), 'player');
        entries.push({
          name,
          shirtNumber: Number(numberText),
          role: role ?? 'STARTER',
          isGoalkeeper: letterText === 'B',
          isStartingCaptain,
        });
        // Yellow card minutes sit in ŽK, a red card minute in ČK. A second
        // yellow is printed twice, as a yellow and as a red at the same minute;
        // that pair is one second yellow, any other red a straight red.
        const yellows = (yellowText!.match(/\d+/g) ?? []).map(Number);
        const reds = (redText!.match(/\d+/g) ?? []).map(Number);
        for (const minute of yellows) {
          const isSecond = yellows.indexOf(minute) > 0 && reds.includes(minute);
          cards.push({
            side,
            player: name,
            kind: isSecond ? 'SECOND_YELLOW' : 'YELLOW',
            at: { minute, stoppageMinute: null },
          });
        }
        for (const minute of reds.filter((minute) => !yellows.includes(minute))) {
          cards.push({
            side,
            player: name,
            kind: 'RED',
            at: { minute, stoppageMinute: null },
          });
        }
        for (const span of change === undefined
          ? []
          : findAll(
              change,
              (element) => element.tag === 'span' && element.attributes['title'] !== undefined,
            )) {
          const minute = minuteMark.exec(textOf(span));
          if (minute === null) note(`the change of "${nameText}" has no minute, "${textOf(span)}"`);
          changes.push({
            side,
            player: name,
            counterpart: span.attributes['title']!,
            minute: minute === null ? 0 : Number(minute[1]),
            role: role ?? 'STARTER',
          });
        }
      }
    }
    return { ...teams[side], entries };
  };
  const home = sheet('HOME');
  const away = sheet('AWAY');
  const sheets = { HOME: home, AWAY: away };

  // Substitutions: every change is named from both rows; each pair at a
  // minute is one substitution, the starter going off, or, between two
  // substitutes, the one who had come on earlier.
  const printed = ({ familyName, givenName }: PersonName) => `${familyName} ${givenName}`;
  const substitutions: Array<Substitution> = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const key = [
      change.side,
      change.minute,
      ...[printed(change.player), change.counterpart].sort(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const partner = sheets[change.side].entries.find(
      (entry) => printed(entry.name) === change.counterpart,
    );
    if (partner === undefined) {
      note(
        `"${printed(change.player)}" changed with "${change.counterpart}", who is not on the ${change.side.toLowerCase()} team sheet`,
      );
      continue;
    }
    const cameOnEarlier = (player: PersonName) =>
      changes.some(
        (other) =>
          other.side === change.side &&
          other.role === 'SUBSTITUTE' &&
          printed(other.player) === printed(player) &&
          other.minute < change.minute,
      );
    const playerOut =
      change.role === 'STARTER'
        ? true
        : partner.role === 'STARTER'
          ? false
          : cameOnEarlier(change.player)
            ? true
            : cameOnEarlier(partner.name)
              ? false
              : null;
    if (playerOut === null) {
      note(
        `"${printed(change.player)}" and "${change.counterpart}" changed in minute ${change.minute}, but the page does not say who went off`,
      );
      continue;
    }
    substitutions.push({
      side: change.side,
      outgoing: playerOut ? change.player : partner.name,
      incoming: playerOut ? partner.name : change.player,
      at: { minute: change.minute, stoppageMinute: null },
    });
  }

  // Consistency: the goals add up to the score, and every scorer is on the
  // sheet of the side credited, or the other side's for an own goal.
  const homeGoals = goals.filter((goal) => goal.side === 'HOME').length;
  const awayGoals = goals.length - homeGoals;
  if (score !== null && shootout === null) {
    if (homeGoals !== Number(score[1]) || awayGoals !== Number(score[2])) {
      note(
        `the timeline has ${homeGoals}:${awayGoals} goals but the score is ${score[1]}:${score[2]}`,
      );
    }
  }
  if (score !== null && shootout !== null) {
    const winner =
      shootout.home > shootout.away ? '1:0' : shootout.home < shootout.away ? '0:1' : '';
    if (homeGoals !== awayGoals || `${score[1]}:${score[2]}` !== winner) {
      note(
        `the timeline has ${homeGoals}:${awayGoals} goals and the shoot-out ${shootout.home}:${shootout.away}, but the score is ${score[1]}:${score[2]}`,
      );
    }
  }
  for (const goal of goals) {
    const side = goal.kind === 'OWN_GOAL' ? opposite(goal.side) : goal.side;
    if (!sheets[side].entries.some((entry) => printed(entry.name) === printed(goal.scorer))) {
      note(`scorer "${printed(goal.scorer)}" is not on the ${side.toLowerCase()} team sheet`);
    }
  }

  if (findings.length > 0) {
    return Effect.fail(
      new MatchReportParseError({
        message: `The page does not read as a match report: ${findings.join('; ')}`,
        findings,
      }),
    );
  }
  return Effect.succeed({
    source: { provider: 'FACR', matchNumber: detail('Číslo utkání') },
    competition: {
      name: competitionName.trim(),
      sex:
        find(root, (element) => element.tag === 'a' && textOf(element) === womensBreadcrumb) ===
        undefined
          ? 'MALE'
          : 'FEMALE',
    },
    round: { name: roundName.trim(), position: position === null ? null : Number(position[1]) },
    kickoff: {
      date: `${year}-${pad(month)}-${pad(day)}`,
      time: `${pad(hour)}:${minute}`,
      timezone,
    },
    venue: detail('Hřiště'),
    attendance: attendance === null ? null : Number(attendance),
    fullTimeScore:
      shootout === null
        ? { home: Number(score![1]), away: Number(score![2]) }
        : { home: homeGoals, away: awayGoals },
    halfTimeScore:
      halfTime === null ? null : { home: Number(halfTime[3]), away: Number(halfTime[4]) },
    penaltyShootout: shootout,
    home,
    away,
    goals,
    cards,
    substitutions,
    officials,
  });
};
