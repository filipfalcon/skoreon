import { base } from '#schema/Base';
import { Source } from '#schema/Enums';
import { teams } from '#schema/Teams';
import { isNull } from 'drizzle-orm';
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// How a source identifies a team. Where a source publishes its own identifier,
// FAČR linking each team to its club, the identifier settles the team no
// matter how the page spells it. Learned once, from a reviewer's decision or
// a team created from the page; from then on the source's identifier resolves
// by itself.
export const teamSourceIds = sqliteTable(
  'team_source_ids',
  {
    ...base(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    source: text('source', { enum: Source.literals }).notNull(),
    externalId: text('external_id').notNull(),
  },
  (t) => [
    uniqueIndex('team_source_ids_source_external_id_unq')
      .on(t.source, t.externalId)
      .where(isNull(t.deletedAt)),
  ],
);
