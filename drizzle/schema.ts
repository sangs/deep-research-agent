import { pgTable, text, bigint, boolean, integer, doublePrecision, jsonb, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';

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

// ── Usage limits (lib/usage.ts) ─────────────────────────────────────────────
// One row per (run, provider, model): actual cost reported by the provider
// (OpenRouter usage.cost, Exa costDollars). `day` is the user's local calendar
// day at record time — the unit the daily budget is enforced on.
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  day: text('day').notNull(), // YYYY-MM-DD in the user's timezone
  feature: text('feature').notNull(), // 'deep_research' | 'news' | 'newsletter'
  provider: text('provider').notNull(), // 'openrouter' | 'exa'
  model: text('model'),
  costUsd: doublePrecision('cost_usd').notNull(),
  runId: text('run_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), // epoch ms
}, (table) => [
  index('usage_events_user_day_idx').on(table.userId, table.day),
  index('usage_events_user_feature_created_idx').on(table.userId, table.feature, table.createdAt),
]);

// Audit trail of consented daily-budget raises. The latest row for (user, day)
// is that day's limit; with no row the default applies. Raises expire with the day.
export const budgetRaises = pgTable('budget_raises', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  day: text('day').notNull(),
  limitUsd: doublePrecision('limit_usd').notNull(),
  previousLimitUsd: doublePrecision('previous_limit_usd').notNull(),
  approvedBy: text('approved_by').notNull(), // signed-in email that consented
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => [index('budget_raises_user_day_idx').on(table.userId, table.day)]);

// Fixed-window request counters shared by all server instances.
export const rateLimitCounters = pgTable('rate_limit_counters', {
  userId: text('user_id').notNull(),
  bucket: text('bucket').notNull(),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(), // epoch seconds
  count: integer('count').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.bucket, table.windowStart] })]);

// ── Gmail organize audit log (backend/services/gmail_organizer.py) ──────────
// One row per user-initiated label/move/organize. `before` holds each
// message's label ids before the change, so the action can be undone exactly.
// Written and read by the backend (asyncpg); defined here so Drizzle owns the schema.
export const gmailActions = pgTable('gmail_actions', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 'move' | 'label' | 'organize'
  actor: text('actor').notNull(), // signed-in email that triggered it
  messageIds: text('message_ids').array().notNull(),
  addedLabelIds: text('added_label_ids').array().notNull(),
  removedLabelIds: text('removed_label_ids').array().notNull(),
  labelNames: text('label_names').array().notNull(),
  before: jsonb('before').notNull(), // { messageId: labelIds[] }
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  undoneAt: bigint('undone_at', { mode: 'number' }),
  undoneBy: text('undone_by'),
}, (table) => [index('gmail_actions_created_idx').on(table.createdAt)]);

// ── Newsletter per-email store (backend/services/newsletter_store.py) ──────
// Scale-out Phase 1 (architecture/features/13-newsletter-scale-out-plan-2026-10-20.md):
// each email is summarized once and reused by every later digest run that
// includes it. Rows are keyed by Gmail message id; which emails belong to a
// run still comes from Gmail, so deleted/moved emails drop out on their own.
// Topic grouping is not stored (it depends on the set of emails in a run).
export const newsletterEmails = pgTable('newsletter_emails', {
  messageId: text('message_id').primaryKey(),
  sender: text('sender').notNull(), // raw From header
  subject: text('subject').notNull(),
  dateHeader: text('date_header').notNull(), // raw Date header, formatted per reader timezone at read time
  snippet: text('snippet').notNull(),
  links: text('links').array().notNull(),
  summary: text('summary').notNull(),
  summaryVersion: integer('summary_version').notNull(), // SUMMARY_VERSION in gmail_service.py; older rows are re-summarized
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), // epoch ms; retention purge uses this
}, (table) => [index('newsletter_emails_created_idx').on(table.createdAt)]);
