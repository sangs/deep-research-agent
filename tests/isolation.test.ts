// Isolation suite (design 14 §5.4): user B can never read, change or delete
// user A's rows, at the database layer (row security, as app_login) and at the
// API layer (the real route handlers). Needs the disposable database from
// scripts/test-db.sh (TEST_ADMIN_DATABASE_URL + APP_DATABASE_URL); skipped otherwise.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL;
const suite = ADMIN_URL && APP_URL ? describe : describe.skip;

// The signed-in user for route handlers (lib/user-id reads the Auth.js session in the app).
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role: 'owner' | 'member' } }));
vi.mock('@/lib/user-id', () => ({
  sessionUser: async () => session.user,
  sessionUserId: async () => session.user?.id ?? null,
  isOwner: (u: { role: string } | null) => u?.role === 'owner',
}));

const OWNER = '32087c9e-d37e-4b7c-896e-58da85f4d108'; // created by migration 0007
const A = 'user-a-0000';
const B = 'user-b-0000';
const as = (id: string, role: 'owner' | 'member' = 'member') => {
  session.user = { id, email: `${id}@example.com`, role };
};
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, 'http://localhost'), init as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let admin: postgres.Sql;

/** Resolves when `p` fails with a database error matching `pattern` (Drizzle
 *  wraps Postgres errors as "Failed query: …" with the original as `cause`). */
async function failsWith(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e as { message?: string; cause?: { message?: string } });
  expect(err, 'expected the query to fail').not.toBeNull();
  expect(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`).toMatch(pattern);
}

const TODAY = new Date().toISOString().slice(0, 10); // UTC day, as usageSummary(…, 'UTC') sees it

async function seed(userId: string) {
  const t = Date.now();
  await admin`insert into users (id, email, role, status, created_at, approved_at)
              values (${userId}, ${userId + '@example.com'}, 'member', 'active', ${t}, ${t})`;
  await admin`insert into research_sessions values (${userId + '-r1'}, ${userId}, ${'title ' + userId}, '[]', 1, 1),
                                                   (${userId + '-r2'}, ${userId}, ${'title2 ' + userId}, '[]', 2, 2)`;
  await admin`insert into news_digests (id, user_id, cache_key, digest, mode, locked, generated_at, expires_at)
              values (${userId + '-d1'}, ${userId}, ${'key-' + userId}, '{"secret":"' || ${userId} || '"}', 'newsletter', true, 1, 9999999999),
                     (${userId + '-d2'}, ${userId}, 'shared-key', '{}', null, false, 1, 9999999999)`;
  await admin`insert into curated_sources (id, user_id, domain, list_type, added_at)
              values (${userId + '-s1'}, ${userId}, 'shared.example', 'news_sites', 1),
                     (${userId + '-s2'}, ${userId}, ${userId + '.example'}, 'research_sites', 1)`;
  await admin`insert into usage_events (id, user_id, day, feature, provider, model, cost_usd, run_id, created_at)
              values (${userId + '-u1'}, ${userId}, ${TODAY}, 'news', 'exa', null, 0.5, ${userId + '-run'}, ${t})`;
  await admin`insert into budget_raises values (${userId + '-b1'}, ${userId}, ${TODAY}, 4, 2, ${userId}, 1)`;
  await admin`insert into rate_limit_counters values (${userId}, 'news', 1, 1)`;
  await admin`insert into ingest_jobs (id, kind, status, message_ids, requested_by, total, created_at)
              values (${userId + '-job'}, 'on_demand', 'done', '{}', ${userId}, 0, 1)`;
}

async function countFor(userId: string) {
  const [r] = await admin`select
      (select count(*)::int from research_sessions where user_id = ${userId}) research,
      (select count(*)::int from news_digests where user_id = ${userId}) digests,
      (select count(*)::int from curated_sources where user_id = ${userId}) sources,
      (select count(*)::int from usage_events where user_id = ${userId}) usage,
      (select count(*)::int from budget_raises where user_id = ${userId}) raises,
      (select count(*)::int from rate_limit_counters where user_id = ${userId}) rate,
      (select count(*)::int from users where id = ${userId}) users`;
  return r;
}

suite('per-user isolation', () => {
  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
    await admin`delete from users where id in (${A}, ${B})`;
    await seed(A);
    await seed(B);
  });
  afterAll(async () => {
    await admin?.end();
  });

  describe('database layer (row security as app_login)', () => {
    it('the login role alone can read nothing', async () => {
      const raw = postgres(APP_URL!, { max: 1 });
      try {
        for (const table of ['research_sessions', 'news_digests', 'curated_sources', 'usage_events', 'users', 'audit_log']) {
          await expect(raw.unsafe(`select count(*) from ${table}`)).rejects.toThrow(/permission denied/);
        }
      } finally {
        await raw.end();
      }
    });

    it('withUser sees only that user, even with no user_id filter', async () => {
      const { withUser } = await import('@/lib/db-access');
      const rows = await withUser(A, (tx) =>
        tx.execute(sql`select
          (select array_agg(distinct user_id) from research_sessions) research,
          (select array_agg(distinct user_id) from news_digests) digests,
          (select array_agg(distinct user_id) from curated_sources) sources,
          (select array_agg(distinct user_id) from usage_events) usage,
          (select array_agg(distinct user_id) from budget_raises) raises,
          (select array_agg(distinct user_id) from rate_limit_counters) rate,
          (select array_agg(id) from users) users,
          (select array_agg(requested_by) from ingest_jobs) jobs`),
      );
      expect(rows[0]).toEqual({ research: [A], digests: [A], sources: [A], usage: [A], raises: [A], rate: [A], users: [A], jobs: [A] });
    });

    it('withUser cannot change, delete or create rows for another user', async () => {
      const { withUser } = await import('@/lib/db-access');
      await withUser(A, async (tx) => {
        await tx.execute(sql`update research_sessions set title = 'hacked' where user_id = ${B}`);
        await tx.execute(sql`delete from news_digests where user_id = ${B}`);
        await tx.execute(sql`delete from curated_sources where user_id = ${B}`);
      });
      await failsWith(
        withUser(A, (tx) => tx.execute(sql`update users set status = 'suspended' where id = ${B}`)),
        /permission denied/,
      );
      expect(await countFor(B)).toMatchObject({ research: 2, digests: 2, sources: 2, users: 1 });
      const [b] = await admin`select title from research_sessions where id = ${B + '-r1'}`;
      expect(b.title).toBe(`title ${B}`);
      await failsWith(
        withUser(A, (tx) => tx.execute(sql`insert into research_sessions values ('x', ${B}, 't', '[]', 1, 1)`)),
        /row-level security/,
      );
    });

    it('a transaction with no user id sees nothing', async () => {
      const { withUser } = await import('@/lib/db-access');
      const rows = await withUser(A, (tx) =>
        tx.execute(sql`select set_config('app.user_id', '', true), (select count(*)::int from research_sessions) n`),
      );
      expect(rows[0].n).toBe(0);
    });

    it("the worker role can't read research, digests or sources, but can total spend", async () => {
      const { withWorker } = await import('@/lib/db-access');
      for (const table of ['research_sessions', 'news_digests', 'curated_sources', 'budget_raises']) {
        await failsWith(withWorker('owner_console', (tx) => tx.execute(sql.raw(`select count(*) from ${table}`))), /permission denied/);
      }
      const [row] = await withWorker('app_budget', (tx) =>
        tx.execute(sql`select count(distinct user_id)::int n from usage_events where user_id in (${A}, ${B})`),
      );
      expect(row.n).toBe(2);
    });

    it('role and user id never leak to the next transaction on the connection', async () => {
      const { withUser, withWorker } = await import('@/lib/db-access');
      await withUser(A, (tx) => tx.execute(sql`select 1`));
      const [row] = await withWorker('owner_console', (tx) =>
        tx.execute(sql`select current_user, coalesce(current_setting('app.user_id', true), '') uid`),
      );
      expect(row).toEqual({ current_user: 'app_worker', uid: '' });
    });
  });

  describe('API layer (user B against user A)', () => {
    it("research history lists and loads only B's sessions", async () => {
      as(B);
      const list = await (await import('@/app/api/history/research/route')).GET();
      expect((await list.json()).map((r: { id: string }) => r.id).sort()).toEqual([`${B}-r1`, `${B}-r2`]);
      const one = await import('@/app/api/history/research/[id]/route');
      expect((await one.GET(req('/x'), params(`${A}-r1`))).status).toBe(404);
    });

    it("B's deletes never touch A's sessions", async () => {
      as(B);
      const one = await import('@/app/api/history/research/[id]/route');
      await one.DELETE(req('/x', { method: 'DELETE' }), params(`${A}-r1`));
      // Overwriting A's session id from B's account must not change A's row.
      const all = await import('@/app/api/history/research/route');
      // (It fails on the primary key: B can't see A's row, so it tries an insert.)
      await all.POST(req('/x', { method: 'POST', body: JSON.stringify({ id: `${A}-r2`, title: 'from B', messages: [] }) })).catch(() => null);
      expect((await countFor(A)).research).toBe(2);
      const [a] = await admin`select title, user_id from research_sessions where id = ${A + '-r2'}`;
      expect(a).toEqual({ title: `title2 ${A}`, user_id: A });
    });

    it("digests: B can't load, rename or delete A's, even with the same cache key", async () => {
      as(B);
      const news = await import('@/app/api/history/news/route');
      expect(await (await news.GET(req(`/x?key=key-${A}`))).json()).toEqual({ digest: null });
      await news.PATCH(req('/x', { method: 'PATCH', body: JSON.stringify({ cacheKey: `key-${A}`, label: 'B was here' }) }));
      await news.DELETE(req(`/x?key=key-${A}`, { method: 'DELETE' }));
      await news.POST(req('/x', { method: 'POST', body: JSON.stringify({ cacheKey: 'shared-key', digest: { by: 'B' } }) }));
      const rows = await admin`select cache_key, label, digest from news_digests where user_id = ${A} order by cache_key`;
      expect(rows.map((r) => [r.cache_key, r.label])).toEqual([[`key-${A}`, null], ['shared-key', null]]);
      expect(rows.find((r) => r.cache_key === 'shared-key')!.digest).toBe('{}');
      const list = await (await import('@/app/api/history/news/list/route')).GET(req('/x?mode=newsletter'));
      expect((await list.json()).items.map((i: { cacheKey: string }) => i.cacheKey)).toEqual([`key-${B}`]);
    });

    it("sources: B sees and edits only B's lists", async () => {
      as(B);
      const sources = await import('@/app/api/sources/route');
      const mine = await (await sources.GET()).json();
      expect(mine.research_sites).toEqual([`${B}.example`]);
      await sources.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'remove', domains: ['shared.example'], list_type: 'news_sites' }) }));
      expect((await countFor(A)).sources).toBe(2);
      expect((await countFor(B)).sources).toBe(1);
    });

    it("newsletter job progress: B gets 404 for A's job", async () => {
      as(B);
      const jobs = await import('@/app/api/newsletter/jobs/[id]/route');
      expect((await jobs.GET(new Request('http://x'), params(`${A}-job`))).status).toBe(404);
      expect((await jobs.GET(new Request('http://x'), params(`${B}-job`))).status).toBe(200);
    });

    it("export contains only B's data", async () => {
      as(B);
      const exp = await import('@/app/api/account/export/route');
      const text = await (await exp.GET()).text();
      expect(text).toContain(`${B}-r1`);
      expect(text).not.toContain(A);
      const body = JSON.parse(text);
      expect(body.account.email).toBe(`${B}@example.com`);
      expect(body.usage).toHaveLength(1);
    });

    it("usage summary and budget count only B's spend", async () => {
      const { usageSummary } = await import('@/lib/usage');
      const summary = await usageSummary(B, 'UTC');
      expect(summary.last30Days.reduce((s, d) => s + d.spentUsd, 0)).toBeCloseTo(0.5);
      expect(summary.raises).toHaveLength(1);
    });
  });

  describe('Gmail mailboxes (Phase C, design 15)', () => {
    const mb = (u: string) => `${u}-mb`;
    beforeAll(async () => {
      const t = Date.now();
      for (const u of [A, B]) {
        await admin`update users set gmail_enabled = ${u === A} where id = ${u}`;
        await admin`insert into user_identities (provider, subject, user_id, created_at) values ('google', ${'sub-' + u}, ${u}, ${t})`;
        await admin`insert into mailboxes (id, user_id, google_sub, email, status, connected_at)
                    values (${mb(u)}, ${u}, ${'sub-' + u}, ${u + '@gmail.example'}, 'active', ${t})`;
        await admin`insert into gmail_credentials (mailbox_id, token_ciphertext, token_nonce, data_key_ciphertext, kms_key_name, scopes, client_id, created_at)
                    values (${mb(u)}, ${Buffer.from('ct-' + u)}, ${Buffer.from('nonce')}, ${Buffer.from('dk')}, 'local',
                            ${['https://www.googleapis.com/auth/gmail.modify']}, 'client', ${t})`;
        await admin`insert into gmail_cap_ledger (google_sub, first_granted_at) values (${'sub-' + u}, ${t})`;
        await admin`insert into newsletter_emails (mailbox_id, message_id, sender, subject, date_header, snippet, links, summary, summary_version, created_at)
                    values (${mb(u)}, ${'msg-' + u}, 'news@x', ${'secret subject ' + u}, 'd', 's', '{}', 'sum', 1, ${t}),
                           (${mb(u)}, 'same-message-id', 'news@x', 's', 'd', 's', '{}', 'sum', 1, ${t})`
          .catch(async (e) => {
            // Until the contract migration, message_id alone is still the primary key, so the
            // shared id can exist once only; the per-mailbox rows above still prove isolation.
            if (!String(e.message).includes('duplicate key')) throw e;
            await admin`insert into newsletter_emails (mailbox_id, message_id, sender, subject, date_header, snippet, links, summary, summary_version, created_at)
                        values (${mb(u)}, ${'msg-' + u}, 'news@x', ${'secret subject ' + u}, 'd', 's', '{}', 'sum', 1, ${t})`;
          });
        await admin`insert into gmail_actions (id, mailbox_id, kind, actor, message_ids, added_label_ids, removed_label_ids, label_names, before, created_at)
                    values (${u + '-act'}, ${mb(u)}, 'label', ${u}, ${['msg-' + u]}, '{}', '{}', '{}', '{}', ${t})`;
        await admin`insert into ingest_jobs (id, mailbox_id, kind, status, message_ids, total, created_at)
                    values (${u + '-sweep'}, ${mb(u)}, 'scheduled', 'done', '{}', 0, ${t})`;
      }
    });

    it('withUser sees only its own mailbox, summaries, organize history and background sweeps', async () => {
      const { withUser } = await import('@/lib/db-access');
      const [row] = await withUser(A, (tx) =>
        tx.execute(sql`select
          (select array_agg(id) from mailboxes) mailboxes,
          (select array_agg(distinct mailbox_id) from newsletter_emails) emails,
          (select array_agg(mailbox_id) from gmail_actions) actions,
          (select array_agg(id order by id) from ingest_jobs where kind = 'scheduled') sweeps`),
      );
      expect(row).toEqual({ mailboxes: [mb(A)], emails: [mb(A)], actions: [mb(A)], sweeps: [`${A}-sweep`] });
    });

    it('no user can read stored Gmail access or the cap ledger, not even their own', async () => {
      const { withUser } = await import('@/lib/db-access');
      for (const table of ['gmail_credentials', 'gmail_cap_ledger']) {
        await failsWith(withUser(A, (tx) => tx.execute(sql.raw(`select count(*) from ${table}`))), /permission denied/);
      }
    });

    it("withUser can't write into another user's mailbox", async () => {
      const { withUser } = await import('@/lib/db-access');
      await failsWith(
        withUser(A, (tx) =>
          tx.execute(sql`insert into newsletter_emails (mailbox_id, message_id, sender, subject, date_header, snippet, links, summary, summary_version, created_at)
                         values (${mb(B)}, 'planted', 'x', 'x', 'x', 'x', '{}', 'x', 1, 1)`),
        ),
        /row-level security/,
      );
      await failsWith(
        withUser(A, (tx) =>
          tx.execute(sql`insert into gmail_actions (id, mailbox_id, kind, actor, message_ids, added_label_ids, removed_label_ids, label_names, before, created_at)
                         values ('planted', ${mb(B)}, 'label', 'x', '{}', '{}', '{}', '{}', '{}', 1)`),
        ),
        /row-level security/,
      );
      await withUser(A, async (tx) => {
        await tx.execute(sql`update mailboxes set sweep_enabled = false where id = ${mb(B)}`);
        await tx.execute(sql`delete from newsletter_emails where mailbox_id = ${mb(B)}`);
        await tx.execute(sql`update gmail_actions set undone_at = 1 where mailbox_id = ${mb(B)}`);
      });
      const [b] = await admin`select
          (select sweep_enabled from mailboxes where id = ${mb(B)}) sweep,
          (select count(*)::int from newsletter_emails where mailbox_id = ${mb(B)}) emails,
          (select undone_at from gmail_actions where id = ${B + '-act'}) undone`;
      expect(b).toEqual({ sweep: true, emails: expect.any(Number), undone: null });
      expect(b.emails).toBeGreaterThan(0);
    });

    it('a user may only pause or resume background summarizing on their own mailbox, nothing else', async () => {
      const { withUser } = await import('@/lib/db-access');
      const { setSweepEnabled } = await import('@/lib/mailboxes');
      await setSweepEnabled(A, false);
      const [a] = await admin`select sweep_enabled from mailboxes where id = ${mb(A)}`;
      expect(a.sweep_enabled).toBe(false);
      await setSweepEnabled(A, true);
      await failsWith(withUser(A, (tx) => tx.execute(sql`update mailboxes set status = 'active', email = 'x' where id = ${mb(A)}`)), /permission denied/);
    });

    it('Gmail access follows the owner switch (D2); the owner always may', async () => {
      const { gmailAccess, gmailReady } = await import('@/lib/mailboxes');
      const a = await gmailAccess(A);
      expect(a).toMatchObject({ allowed: true, mailbox: { email: `${A}@gmail.example`, status: 'active' } });
      expect(gmailReady(a)).toBe(true);
      const b = await gmailAccess(B);
      expect(b.allowed).toBe(false);
      expect(gmailReady(b)).toBe(false);
      expect((await gmailAccess(OWNER)).allowed).toBe(true);
    });

    it('the owner turns Gmail on and off per member, audited; the console counts the cap ledger', async () => {
      const { applyOwnerAction, listUsersForOwner } = await import('@/lib/users');
      const { gmailCapUsed } = await import('@/lib/mailboxes');
      expect(await applyOwnerAction(OWNER, B, 'enable_gmail')).toBeNull();
      expect((await listUsersForOwner()).find((u) => u.id === B)).toMatchObject({ gmailEnabled: true, gmailStatus: 'active' });
      expect(await applyOwnerAction(OWNER, B, 'disable_gmail')).toBeNull();
      const [audit] = await admin`select count(*)::int n from audit_log where target_user_id = ${B} and action in ('gmail_enabled', 'gmail_disabled')`;
      expect(audit.n).toBe(2);
      expect(await gmailCapUsed()).toBeGreaterThanOrEqual(2);
    });

    it("/api/news refuses Newsletter for a member without Gmail, before any backend call", async () => {
      as(B);
      const { POST } = await import('@/app/api/news/route');
      const res = await POST(req('/api/news', { method: 'POST', body: JSON.stringify({ mode: 'newsletter', timezone: 'UTC' }) }));
      const text = await res.text();
      expect(res.status, text.slice(0, 300)).toBe(403);
      expect(JSON.parse(text).code).toBe('not_enabled');
    });
  });

  describe('account lifecycle', () => {
    it('a new Google account becomes a pending request that can read only its own row', async () => {
      const { resolveSignIn, getUserAccess } = await import('@/lib/users');
      const result = await resolveSignIn('google-sub-new', 'New.Person@Example.com', 'New Person');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const access = await getUserAccess(result.userId);
      expect(access).toMatchObject({ email: 'new.person@example.com', status: 'pending', role: 'member' });
      await admin`delete from users where id = ${result.userId}`;
    });

    it('owner delete is scheduled: the account is locked at once, data kept, and the owner can cancel', async () => {
      const { applyOwnerAction, getUserAccess } = await import('@/lib/users');
      expect(await applyOwnerAction(OWNER, A, 'delete')).toBeNull();
      expect((await getUserAccess(A))?.status).toBe('deleting');
      expect(await countFor(A)).toMatchObject({ research: 2, sources: 2, users: 1 });
      const { cancelOwnDeletion } = await import('@/lib/users');
      expect(await cancelOwnDeletion(A)).toMatch(/only the owner/); // the member can't undo the owner's request
      expect(await applyOwnerAction(OWNER, A, 'cancel_deletion')).toBeNull();
      const [row] = await admin`select status, deletion_requested_at from users where id = ${A}`;
      expect(row).toEqual({ status: 'active', deletion_requested_at: null });
    });

    it('a member can request and cancel deletion of their own account; the owner account cannot be deleted', async () => {
      const { requestOwnDeletion, cancelOwnDeletion } = await import('@/lib/users');
      expect(await requestOwnDeletion(OWNER)).toMatch(/owner/i);
      expect(await requestOwnDeletion(B)).toBeNull();
      const [scheduled] = await admin`select status, deletion_requested_by from users where id = ${B}`;
      expect(scheduled).toEqual({ status: 'deleting', deletion_requested_by: B });
      expect(await cancelOwnDeletion(B)).toBeNull();
      const [restored] = await admin`select status from users where id = ${B}`;
      expect(restored.status).toBe('active');
    });

    it('the purge removes only accounts past the 30-day grace period, with all data, and strips emails from the audit log', async () => {
      const { withWorker } = await import('@/lib/db-access');
      const { requestOwnDeletion, applyOwnerAction } = await import('@/lib/users');
      const t = Date.now();
      await admin`insert into audit_log (id, actor_user_id, action, target_user_id, metadata, created_at)
                  values ('pre-approve-A', ${OWNER}, 'access_preapproved', ${A}, ${admin.json({ email: 'a@example.com' })}, ${t})`;
      expect(await applyOwnerAction(OWNER, A, 'delete')).toBeNull();
      expect(await requestOwnDeletion(B)).toBeNull();
      // A's request is 31 days old; B's is from today.
      await admin`update users set deletion_requested_at = ${t - 31 * 86_400_000} where id = ${A}`;

      const [res] = await withWorker('retention', (tx) => tx.execute(sql`select purge_deleted_accounts(30) n`));
      expect(res.n).toBe(1);
      expect(await countFor(A)).toEqual({ research: 0, digests: 0, sources: 0, usage: 0, raises: 0, rate: 0, users: 0 });
      expect(await countFor(B)).toMatchObject({ research: 2, users: 1 }); // still in its grace period
      const entries = await admin`select action, metadata from audit_log where target_user_id = ${A} or actor_user_id = ${A}`;
      expect(entries.some((e) => JSON.stringify(e.metadata).includes('@'))).toBe(false);
      expect(entries.find((e) => e.action === 'account_deleted')?.metadata).toEqual({ grace_days: 30, requested_by: 'owner' });
      const [owner] = await admin`select count(*)::int n from users where id = ${OWNER}`;
      expect(owner.n).toBe(1);
      // Gmail: mailbox, stored access, summaries, organize history and sweeps go with the account;
      // the cap ledger keeps the Google account id (it counts against Google's lifetime limit).
      const [gmail] = await admin`select
          (select count(*)::int from mailboxes where user_id = ${A}) mailboxes,
          (select count(*)::int from gmail_credentials where mailbox_id = ${A + '-mb'}) creds,
          (select count(*)::int from newsletter_emails where mailbox_id = ${A + '-mb'}) emails,
          (select count(*)::int from gmail_actions where mailbox_id = ${A + '-mb'}) actions,
          (select count(*)::int from ingest_jobs where mailbox_id = ${A + '-mb'}) jobs,
          (select count(*)::int from gmail_cap_ledger where google_sub = ${'sub-' + A}) ledger`;
      expect(gmail).toEqual({ mailboxes: 0, creds: 0, emails: 0, actions: 0, jobs: 0, ledger: 1 });
    });

    it('a locked (deleting) account gets no data through the app', async () => {
      const { getUserAccess } = await import('@/lib/users');
      expect((await getUserAccess(B))?.status).toBe('deleting'); // proxy.ts sends non-active users to /access; API 403
    });
  });
});
