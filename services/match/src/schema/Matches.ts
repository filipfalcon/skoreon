import { base } from '#schema/Base';
import { MatchStatus } from '#schema/Enums';
import { isNull, sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const matches = sqliteTable(
  'matches',
  {
    ...base(),
    editionId: text('edition_id').notNull(),
    roundId: text('round_id').notNull(),
    groupId: text('group_id'),
    homeParticipationId: text('home_participation_id').notNull(),
    awayParticipationId: text('away_participation_id').notNull(),
    status: text('status', { enum: MatchStatus.literals }).notNull(),
    number: text('number'),
    kickoffAt: integer('kickoff_at', { mode: 'timestamp_ms' }).notNull(),
    timezone: text('timezone').notNull(),
    venue: text('venue'),
    // Regulation length actually played, excluding stoppage: 90 normally, 120
    // when extra time was played, less if the match was abandoned. The only
    // record of extra time when nothing happened during it.
    //
    // Reading event minutes: elapsed time is `minute + coalesce(stoppage_minute, 0)`,
    // which is identical whether a source publishes 90+3 or a continuous 93. An
    // event is in added time when `stoppage_minute` is set, or when `minute`
    // exceeds the period boundary implied by this column.
    //
    // Sources using a continuous clock leave a few minutes after each boundary
    // genuinely ambiguous — in a 120-minute match, 93 is either 90+3 stoppage or
    // the 3rd minute of extra time. Treat that band as unknown; do NOT infer a
    // period. Period-accurate data requires a source that publishes stoppage
    // separately, and cannot be recovered downstream.
    durationMinutes: integer('duration_minutes'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    homeHalfTimeScore: integer('home_half_time_score'),
    awayHalfTimeScore: integer('away_half_time_score'),
    // A penalty shoot-out, when a drawn tie was decided by one; the score
    // above stays the score after play. Both set or neither.
    homePenaltyScore: integer('home_penalty_score'),
    awayPenaltyScore: integer('away_penalty_score'),
    attendance: integer('attendance'),
  },
  (t) => [
    uniqueIndex('matches_number_unq').on(t.number).where(isNull(t.deletedAt)),
    check(
      'matches_participations_distinct',
      sql`${t.homeParticipationId} <> ${t.awayParticipationId}`,
    ),
    check(
      'matches_scores_non_negative',
      sql`(${t.homeScore} is null or ${t.homeScore} >= 0) and (${t.awayScore} is null or ${t.awayScore} >= 0)`,
    ),
    check(
      'matches_half_time_scores_non_negative',
      sql`(${t.homeHalfTimeScore} is null or ${t.homeHalfTimeScore} >= 0) and (${t.awayHalfTimeScore} is null or ${t.awayHalfTimeScore} >= 0)`,
    ),
    // A running score never decreases, so half-time can never exceed full-time.
    check(
      'matches_half_time_scores_within_full_time',
      sql`(${t.homeHalfTimeScore} is null or ${t.homeScore} is null or ${t.homeHalfTimeScore} <= ${t.homeScore}) and (${t.awayHalfTimeScore} is null or ${t.awayScore} is null or ${t.awayHalfTimeScore} <= ${t.awayScore})`,
    ),
    check(
      'matches_penalty_scores_paired',
      sql`(${t.homePenaltyScore} is null) = (${t.awayPenaltyScore} is null)`,
    ),
    check(
      'matches_penalty_scores_non_negative',
      sql`(${t.homePenaltyScore} is null or ${t.homePenaltyScore} >= 0) and (${t.awayPenaltyScore} is null or ${t.awayPenaltyScore} >= 0)`,
    ),
    // A shoot-out only follows a draw, and it always finds a winner.
    check(
      'matches_penalty_scores_decide_a_draw',
      sql`${t.homePenaltyScore} is null or (${t.homeScore} = ${t.awayScore} and ${t.homePenaltyScore} <> ${t.awayPenaltyScore})`,
    ),
    check('matches_attendance_non_negative', sql`${t.attendance} is null or ${t.attendance} >= 0`),
    check(
      'matches_duration_minutes_positive',
      sql`${t.durationMinutes} is null or ${t.durationMinutes} > 0`,
    ),
  ],
);
