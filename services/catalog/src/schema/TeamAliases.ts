import { base } from '#schema/Base';
import { Source } from '#schema/Enums';
import { teams } from '#schema/Teams';
import { isNull } from 'drizzle-orm';
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// How a source spells a team. Sources abbreviate and punctuate as they please,
// "Lokomotiva Brno H.H." for "Lokomotiva Brno Horní Heršpice", and the catalog
// keeps one name. A spelling is learned when a person resolves it once during
// review; from then on the same spelling resolves by itself.
export const teamAliases = sqliteTable(
  'team_aliases',
  {
    ...base(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    source: text('source', { enum: Source.literals }).notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    uniqueIndex('team_aliases_source_name_unq').on(t.source, t.name).where(isNull(t.deletedAt)),
  ],
);
