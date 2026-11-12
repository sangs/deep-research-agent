import { pgTable, text, bigint, boolean, integer, doublePrecision, jsonb, uniqueIndex, index, primaryKey, customType } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ── Identity & access (lib/users.ts; design: architecture/features/14-per-user-data-isolation-design-2026-10-27.md) ──
// Every user's data is private to them. Access is owner-approved: an unknown
// Google account that signs in becomes a 'pending' row until the owner approves it.
export const users = pgTable('users', {
  id: text('id').primaryKey(), // UUID; the owner keeps the pre-multi-user fixed id
  email: text('email').notNull(), // lower-cased
  name: text('name'),
  role: text('role').notNull().default('member'), // 'owner' | 'member' | 'system' (newsletter sweeps' cost account; never signs in)
  status: text('status').notNull().default('pending'), // 'pending' | 'active' | 'suspended' | 'deleting'
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), // epoch ms
  approvedAt: bigint('approved_at', { mode: 'number' }),
  approvedBy: text('approved_by'), // user id of the owner who approved
  lastLoginAt: bigint('last_login_at', { mode: 'number' }),
  // Account deletion has a 30-day grace period (design 14 §8): status 'deleting'
  // until purge_deleted_accounts() (migration 0011, run by the background job)
  // removes the row and, by cascade, all of the user's data.
  deletionRequestedAt: bigint('deletion_requested_at', { mode: 'number' }),
  deletionRequestedBy: text('deletion_requested_by'), // user id: the member themselves or the owner
  statusBeforeDeletion: text('status_before_deletion'), // restored if the deletion is cancelled
  // Phase C (design 15, decision D2): the owner turns Gmail on per member (the Google
  // project allows at most 100 users ever to grant the Gmail scope). The owner always may.
  gmailEnabled: boolean('gmail_enabled').notNull().default(false),
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  index('users_status_created_idx').on(table.status, table.createdAt),
]);

// One row per linked sign-in account. Keyed by Google's `sub`, which never
// changes or gets reassigned (emails can).
export const userIdentities = pgTable('user_identities', {
  provider: text('provider').notNull(), // 'google'
  subject: text('subject').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emailAtLink: text('email_at_link'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.subject] }),
  index('user_identities_user_idx').on(table.userId),
]);

// Append-only record of sign-ins and access changes. Not FK'd to users so the
// trail outlives a deleted account.
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id'), // null for system actions
  action: text('action').notNull(), // 'sign_in' | 'access_requested' | 'access_approved' | …
  targetUserId: text('target_user_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => [
  index('audit_log_created_idx').on(table.createdAt),
  index('audit_log_target_created_idx').on(table.targetUserId, table.createdAt),
]);

// Template copied into a user's own curated_sources when they become active.
// Also what MCP callers (no user) search with.
export const defaultSources = pgTable('default_sources', {
  domain: text('domain').notNull(),
  listType: text('list_type').notNull(),
}, (table) => [primaryKey({ columns: [table.domain, table.listType] })]);

const ownerUserId = () => text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });

export const researchSessions = pgTable('research_sessions', {
  id: text('id').primaryKey(),
  userId: ownerUserId(),
  title: text('title').notNull(),
  messages: text('messages').notNull(), // JSON-serialised UIMessage[]
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const newsDigests = pgTable('news_digests', {
  id: text('id').primaryKey(),
  userId: ownerUserId(),
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

// Each user's own source lists, seeded from default_sources on activation.
export const curatedSources = pgTable('curated_sources', {
  id: text('id').primaryKey(),
  userId: ownerUserId(),
  domain: text('domain').notNull(),
  listType: text('list_type').notNull(), // 'news_sites' | 'research_sites' | 'newsletters' | 'global_news_sites'
  addedAt: bigint('added_at', { mode: 'number' }).notNull(),
}, (table) => [uniqueIndex('curated_sources_user_domain_list_unique').on(table.userId, table.domain, table.listType)]);

// ── Usage limits (lib/usage.ts) ─────────────────────────────────────────────
// One row per (run, provider, model): actual cost reported by the provider
// (OpenRouter usage.cost, Exa costDollars). `day` is the user's local calendar
// day at record time — the unit the daily budget is enforced on.
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  userId: ownerUserId(),
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
  index('usage_events_created_idx').on(table.createdAt), // app-wide daily cap, owner console spend
]);

// Audit trail of consented daily-budget raises. The latest row for (user, day)
// is that day's limit; with no row the default applies. Raises expire with the day.
export const budgetRaises = pgTable('budget_raises', {
  id: text('id').primaryKey(),
  userId: ownerUserId(),
  day: text('day').notNull(),
  limitUsd: doublePrecision('limit_usd').notNull(),
  previousLimitUsd: doublePrecision('previous_limit_usd').notNull(),
  approvedBy: text('approved_by').notNull(), // signed-in email that consented
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => [index('budget_raises_user_day_idx').on(table.userId, table.day)]);

// Fixed-window request counters shared by all server instances.
export const rateLimitCounters = pgTable('rate_limit_counters', {
  userId: ownerUserId(),
  bucket: text('bucket').notNull(),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(), // epoch seconds
  count: integer('count').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.bucket, table.windowStart] })]);

// ── Connected Gmail mailboxes (Phase C, design 15; backend/services/mailboxes.py) ──
// One per user. The user sees their own row (status, pause switch); connect and
// disconnect go through the backend, which alone holds the credentials.
export const mailboxes = pgTable('mailboxes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  googleSub: text('google_sub').notNull(), // the user's own Google account (decision D1)
  email: text('email').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'reauth_required' | 'disconnected'
  sweepEnabled: boolean('sweep_enabled').notNull().default(true), // background summarizing for this mailbox
  connectedAt: bigint('connected_at', { mode: 'number' }).notNull(),
  disconnectedAt: bigint('disconnected_at', { mode: 'number' }),
  lastSweepAt: bigint('last_sweep_at', { mode: 'number' }),
  lastError: text('last_error'),
  lastErrorAt: bigint('last_error_at', { mode: 'number' }),
}, (table) => [
  uniqueIndex('mailboxes_user_unique').on(table.userId),
  uniqueIndex('mailboxes_google_sub_unique').on(table.googleSub),
  index('mailboxes_status_idx').on(table.status),
]);

// The mailbox's Google refresh token, envelope-encrypted with Cloud KMS
// (backend/services/gmail_credentials.py). Backend worker only: app_user has no grant.
export const gmailCredentials = pgTable('gmail_credentials', {
  mailboxId: text('mailbox_id').primaryKey().references(() => mailboxes.id, { onDelete: 'cascade' }),
  tokenCiphertext: bytea('token_ciphertext').notNull(), // AES-256-GCM, associated data = mailbox id
  tokenNonce: bytea('token_nonce').notNull(),
  dataKeyCiphertext: bytea('data_key_ciphertext').notNull(), // the data key, encrypted by KMS
  kmsKeyName: text('kms_key_name').notNull(), // key (version) that encrypted the data key
  scopes: text('scopes').array().notNull(),
  clientId: text('client_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Every Google account that ever granted the Gmail scope through the app: the
// lifetime cap of 100 (design 15 §8). Not tied to users, so it outlives deletions.
export const gmailCapLedger = pgTable('gmail_cap_ledger', {
  googleSub: text('google_sub').primaryKey(),
  firstGrantedAt: bigint('first_granted_at', { mode: 'number' }).notNull(),
});

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
  mailboxId: text('mailbox_id').references(() => mailboxes.id, { onDelete: 'cascade' }), // Phase C; required after 0013
}, (table) => [
  index('gmail_actions_created_idx').on(table.createdAt),
  index('gmail_actions_mailbox_created_idx').on(table.mailboxId, table.createdAt),
]);

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
  // Phase C: message ids are unique per mailbox only. Nullable until the owner's
  // existing rows are re-pointed; 0013 makes (mailbox_id, message_id) the key.
  mailboxId: text('mailbox_id').references(() => mailboxes.id, { onDelete: 'cascade' }),
}, (table) => [
  index('newsletter_emails_created_idx').on(table.createdAt),
  uniqueIndex('newsletter_emails_mailbox_message_unique').on(table.mailboxId, table.messageId),
]);

// ── Newsletter ingest jobs (backend/services/ingest.py, jobs/ingest.py) ─────
// Scale-out Phase 2: summarizing runs outside the request path. A digest run
// with many unsummarized emails queues an on_demand row; the Cloud Run Job
// `newsletter-ingest` claims queued rows, then sweeps new mail (a scheduled
// row per sweep). Rows are the queue, the progress the UI polls, and the
// record of what each job spent.
export const ingestJobs = pgTable('ingest_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 'on_demand' | 'scheduled'
  status: text('status').notNull(), // 'queued' | 'running' | 'done' | 'failed' | 'capped'
  messageIds: text('message_ids').array().notNull(), // on_demand: emails to summarize; scheduled: filled when the sweep lists them
  requestedBy: text('requested_by'), // user id charged for an on_demand job; null for scheduled sweeps
  timezone: text('timezone'), // requester's IANA timezone (usage day)
  total: integer('total').notNull().default(0),
  doneCount: integer('done_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  error: text('error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), // epoch ms
  startedAt: bigint('started_at', { mode: 'number' }),
  finishedAt: bigint('finished_at', { mode: 'number' }),
  mailboxId: text('mailbox_id').references(() => mailboxes.id, { onDelete: 'cascade' }), // Phase C; required after 0013
}, (table) => [
  index('ingest_jobs_status_created_idx').on(table.status, table.createdAt),
  index('ingest_jobs_mailbox_kind_created_idx').on(table.mailboxId, table.kind, table.createdAt),
  index('ingest_jobs_kind_created_idx').on(table.kind, table.createdAt),
]);

// Owner-controlled switches, one JSON value per key. 'newsletter_ingest':
// { enabled } — pauses the scheduled newsletter sweep (backend/services/ingest.py).
// A missing row means the default (enabled).
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').notNull(), // signed-in email that changed it
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(), // epoch ms
});
