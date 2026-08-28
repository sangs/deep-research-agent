import { pgTable, text, bigint, boolean, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const researchSessions = pgTable('research_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  messages: text('messages').notNull(), // JSON-serialised UIMessage[]
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const newsDigests = pgTable('news_digests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  // NOT globally unique — cache_key alone previously let two different
  // userIds computing the same key (e.g. both on default filters) silently
  // overwrite each other's row via onConflictDoUpdate. Uniqueness is now
  // scoped per user via the composite index below.
  cacheKey: text('cache_key').notNull(),
  digest: text('digest').notNull(), // JSON-serialised NewsDigest
  mode: text('mode'), // e.g. 'newsletter' — null for non-newsletter tabs' rows
  locked: boolean('locked').notNull().default(false), // replaces the old far-future-expiresAt hack
  label: text('label'), // user-provided rename for the Saved Digests picker; null = show default title
  tags: text('tags').array().notNull().default([]), // user-provided tags, multiple per digest
  articleCount: integer('article_count').notNull().default(0),
  rangeStart: text('range_start'), // YYYY-MM-DD
  rangeEnd: text('range_end'),     // YYYY-MM-DD
  generatedAt: bigint('generated_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(), // generatedAt + 3600000 (1 hour)
}, (table) => [
  uniqueIndex('news_digests_user_cache_key_unique').on(table.userId, table.cacheKey),
  index('news_digests_user_mode_generated_idx').on(table.userId, table.mode, table.generatedAt),
]);

export const curatedSources = pgTable('curated_sources', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  listType: text('list_type').notNull(), // 'news_sites' | 'research_sites' | 'newsletters'
  addedAt: bigint('added_at', { mode: 'number' }).notNull(),
});
