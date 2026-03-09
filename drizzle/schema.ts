import { pgTable, text, bigint } from 'drizzle-orm/pg-core';

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
  cacheKey: text('cache_key').notNull().unique(),
  digest: text('digest').notNull(), // JSON-serialised NewsDigest
  generatedAt: bigint('generated_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(), // generatedAt + 3600000 (1 hour)
});

export const curatedSources = pgTable('curated_sources', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  listType: text('list_type').notNull(), // 'news_sites' | 'research_sites' | 'newsletters'
  addedAt: bigint('added_at', { mode: 'number' }).notNull(),
});
