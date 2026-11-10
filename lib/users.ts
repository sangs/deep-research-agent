// Users, sign-in resolution and owner-approved access (server-only).
// Design: documents/architecture/features/14-per-user-data-isolation-design-2026-10-27.md
//
// - Every user's data is private to them; there is no sharing or invite concept.
// - An unknown Google account that signs in becomes a 'pending' access request.
//   The owner approves it (or pre-approves an email) from /admin.
// - Identity is keyed by Google's `sub` (user_identities), never by email.

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { withUser, withWorker, type Tx } from '@/lib/db-access';
import { auditLog, curatedSources, defaultSources, userIdentities, users, usageEvents } from '@/drizzle/schema';
import { isLegacyAllowedEmail, isOwnerBootstrapEmail } from '@/lib/auth-allowlist';

export type Role = 'owner' | 'member' | 'system';
export type AccessStatus = 'pending' | 'active' | 'suspended' | 'deleting';

/** Days between a deletion request and the purge (design 14 §8). Must match
 *  DELETION_GRACE_DAYS in backend/services/ingest.py, which runs the purge. */
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

/** When an account in status 'deleting' will be purged (epoch ms). */
export function deletionDueAt(requestedAt: number): number {
  return requestedAt + DELETION_GRACE_DAYS * DAY_MS;
}

/** The owner's id: kept from the single-tenant era so existing data needed no move. */
export const OWNER_LEGACY_USER_ID = '32087c9e-d37e-4b7c-896e-58da85f4d108';
/** Placeholder email the migration gives the owner row until the owner signs in. */
const UNCLAIMED_OWNER_EMAIL = 'owner@unclaimed.invalid';
const PROVIDER = 'google';

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** Cap on open access requests, so anyone with a Google account can't flood the table. */
const MAX_PENDING_REQUESTS = envNumber('AUTH_MAX_PENDING_REQUESTS', 50);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type Executor = Tx;

export type AuditAction =
  | 'sign_in'
  | 'owner_claimed'
  | 'access_requested'
  | 'access_approved'
  | 'access_preapproved'
  | 'access_request_rejected'
  | 'access_suspended'
  | 'access_reactivated'
  | 'account_deletion_requested'
  | 'account_deletion_cancelled'
  | 'account_deleted'; // written by purge_deleted_accounts() (migration 0011)

export async function audit(
  ex: Executor,
  action: AuditAction,
  actorUserId: string | null,
  targetUserId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await ex.insert(auditLog).values({ id: randomUUID(), action, actorUserId, targetUserId, metadata, createdAt: Date.now() });
}

/** Give a newly active user their own copy of the default source lists. Idempotent. */
async function seedSources(ex: Executor, userId: string) {
  await ex.execute(sql`
    INSERT INTO ${curatedSources} (id, user_id, domain, list_type, added_at)
    SELECT gen_random_uuid()::text, ${userId}, d.domain, d.list_type, ${Date.now()}
    FROM ${defaultSources} d
    ON CONFLICT (user_id, domain, list_type) DO NOTHING`);
}

// ── Access lookups (cached briefly: called by proxy.ts on every request) ────

export interface UserAccess {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccessStatus;
  deletionRequestedAt: number | null;
  deletionRequestedBy: string | null;
}

/** A status change (approve, suspend, delete, cancel) reaches every server
 *  instance, including proxy.ts's own copy of this module, within this window. */
const ACCESS_CACHE_MS = 5_000;
const accessCache = new Map<string, { value: UserAccess | null; expires: number }>();

function forgetAccess(userId: string) {
  accessCache.delete(userId);
}

export async function getUserAccess(userId: string): Promise<UserAccess | null> {
  const hit = accessCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;
  // As the user themselves: row security returns their own row only.
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        deletionRequestedAt: users.deletionRequestedAt,
        deletionRequestedBy: users.deletionRequestedBy,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );
  const value = row ? { ...row, role: row.role as Role, status: row.status as AccessStatus } : null;
  accessCache.set(userId, { value, expires: Date.now() + ACCESS_CACHE_MS });
  return value;
}

/** Internal user id linked to a Google account, or null. */
export async function userIdForGoogleSubject(subject: string): Promise<string | null> {
  const [row] = await withWorker('sign_in', (tx) =>
    tx
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, PROVIDER), eq(userIdentities.subject, subject)))
      .limit(1),
  );
  return row?.userId ?? null;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

export type SignInResult = { ok: true; userId: string } | { ok: false; reason: 'email_in_use' | 'too_many_requests' };

/** Resolve a verified Google sign-in to a user, creating an access request for
 *  unknown accounts. Called from the Auth.js `signIn` callback. */
export async function resolveSignIn(subject: string, rawEmail: string, name: string | null): Promise<SignInResult> {
  const email = normalizeEmail(rawEmail);
  const now = Date.now();

  return withWorker('sign_in', async (tx) => {
    // 1. Known Google account.
    const [linked] = await tx
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, PROVIDER), eq(userIdentities.subject, subject)))
      .limit(1);
    if (linked) {
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, linked.userId));
      await audit(tx, 'sign_in', linked.userId, linked.userId);
      return { ok: true, userId: linked.userId };
    }

    // 2. A row waiting for this account: an email the owner pre-approved, or the
    //    migrated owner row (claimed through AUTH_OWNER_EMAILS).
    const unlinked = (emailMatch: string) =>
      tx
        .select({ id: users.id })
        .from(users)
        .leftJoin(userIdentities, eq(userIdentities.userId, users.id))
        .where(and(eq(users.email, emailMatch), isNull(userIdentities.subject)))
        .limit(1);
    let [claim] = await unlinked(email);
    let ownerClaim = false;
    if (!claim && isOwnerBootstrapEmail(email)) {
      [claim] = await unlinked(UNCLAIMED_OWNER_EMAIL);
      ownerClaim = !!claim;
    }
    if (claim) {
      await tx.update(users).set({ email, name, lastLoginAt: now }).where(eq(users.id, claim.id));
      await tx.insert(userIdentities).values({ provider: PROVIDER, subject, userId: claim.id, emailAtLink: email, createdAt: now });
      await audit(tx, ownerClaim ? 'owner_claimed' : 'sign_in', claim.id, claim.id);
      forgetAccess(claim.id);
      return { ok: true, userId: claim.id };
    }

    // The email belongs to a user already linked to a different Google account.
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken) return { ok: false, reason: 'email_in_use' };

    // 3. New account: an access request (or active, for the legacy env allowlist).
    const active = isLegacyAllowedEmail(email);
    if (!active) {
      const [{ pending }] = await tx
        .select({ pending: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.status, 'pending'));
      if (pending >= MAX_PENDING_REQUESTS) return { ok: false, reason: 'too_many_requests' };
    }
    const userId = randomUUID();
    await tx.insert(users).values({
      id: userId,
      email,
      name,
      role: 'member',
      status: active ? 'active' : 'pending',
      createdAt: now,
      approvedAt: active ? now : null,
      lastLoginAt: now,
    });
    await tx.insert(userIdentities).values({ provider: PROVIDER, subject, userId, emailAtLink: email, createdAt: now });
    if (active) {
      await seedSources(tx, userId);
      await audit(tx, 'access_approved', null, userId, { via: 'AUTH_ALLOWED_EMAILS' });
    } else {
      await audit(tx, 'access_requested', userId, userId);
    }
    return { ok: true, userId };
  });
}

// ── Owner console (/admin) ───────────────────────────────────────────────────
// Account + cost only: nothing here reads any user's research, digests, sources or email.

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccessStatus;
  createdAt: number;
  lastLoginAt: number | null;
  linked: boolean; // has signed in at least once (false: pre-approved, waiting)
  spentTodayUsd: number; // current UTC day
  spent30dUsd: number;
  deletionDueAt: number | null; // status 'deleting': when the purge removes it
}

export async function listUsersForOwner(): Promise<AdminUserRow[]> {
  const now = Date.now();
  const startOfUtcDay = now - (now % 86_400_000);
  return withWorker('owner_console', async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        deletionRequestedAt: users.deletionRequestedAt,
        linked: sql<boolean>`exists (select 1 from ${userIdentities} where ${userIdentities.userId} = ${users.id})`,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    const spend = await tx
      .select({
        userId: usageEvents.userId,
        today: sql<number>`coalesce(sum(${usageEvents.costUsd}) filter (where ${usageEvents.createdAt} >= ${startOfUtcDay}), 0)`,
        last30: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, now - 30 * 86_400_000))
      .groupBy(usageEvents.userId);
    const byUser = new Map(spend.map((s) => [s.userId, s]));
    return rows.map(({ deletionRequestedAt, ...r }) => ({
      ...r,
      deletionDueAt: deletionRequestedAt ? deletionDueAt(deletionRequestedAt) : null,
      role: r.role as Role,
      status: r.status as AccessStatus,
      spentTodayUsd: Number(byUser.get(r.id)?.today ?? 0),
      spent30dUsd: Number(byUser.get(r.id)?.last30 ?? 0),
    }));
  });
}

export type OwnerAction = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'delete' | 'cancel_deletion';

/** Apply an owner action to a member. Returns an error message, or null on success. */
export async function applyOwnerAction(ownerId: string, targetId: string, action: OwnerAction): Promise<string | null> {
  if (targetId === ownerId) return 'You cannot change your own access';
  const now = Date.now();
  const result = await withWorker('owner_console', async (tx) => {
    const [target] = await tx
      .select({ status: users.status, role: users.role })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target) return 'User not found';
    if (target.role !== 'member') return 'Only member accounts can be changed';
    const from = target.status as AccessStatus;

    if (action === 'approve' && from === 'pending') {
      await tx.update(users).set({ status: 'active', approvedAt: now, approvedBy: ownerId }).where(eq(users.id, targetId));
      await seedSources(tx, targetId);
      await audit(tx, 'access_approved', ownerId, targetId);
      return null;
    }
    if (action === 'reject' && from === 'pending') {
      // Deletes the request; the person may ask again later.
      await tx.delete(users).where(eq(users.id, targetId));
      await audit(tx, 'access_request_rejected', ownerId, targetId);
      return null;
    }
    if (action === 'suspend' && from === 'active') {
      await tx.update(users).set({ status: 'suspended' }).where(eq(users.id, targetId));
      await audit(tx, 'access_suspended', ownerId, targetId);
      return null;
    }
    if (action === 'delete' && (from === 'active' || from === 'suspended')) {
      // Scheduled: the account is locked now and purged after the grace period.
      await scheduleDeletion(tx, targetId, ownerId, from);
      return null;
    }
    if (action === 'cancel_deletion' && from === 'deleting') {
      await cancelDeletion(tx, targetId, ownerId);
      return null;
    }
    if (action === 'reactivate' && from === 'suspended') {
      await tx.update(users).set({ status: 'active' }).where(eq(users.id, targetId));
      await seedSources(tx, targetId); // no-op unless they never had sources (e.g. legacy placeholder)
      await audit(tx, 'access_reactivated', ownerId, targetId);
      return null;
    }
    return `Cannot ${action} a user who is ${from}`;
  });
  forgetAccess(targetId);
  return result;
}

/** Pre-approve an email: the account is active the first time that Google account signs in. */
export async function preapproveEmail(ownerId: string, rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
  const now = Date.now();
  return withWorker('owner_console', async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      if (existing.status !== 'pending') return `${email} already has an account (${existing.status})`;
      // An open request from this email: approving it is the same thing.
      await tx.update(users).set({ status: 'active', approvedAt: now, approvedBy: ownerId }).where(eq(users.id, existing.id));
      await seedSources(tx, existing.id);
      await audit(tx, 'access_approved', ownerId, existing.id);
      forgetAccess(existing.id);
      return null;
    }
    const userId = randomUUID();
    await tx.insert(users).values({
      id: userId,
      email,
      role: 'member',
      status: 'active',
      createdAt: now,
      approvedAt: now,
      approvedBy: ownerId,
    });
    await seedSources(tx, userId);
    await audit(tx, 'access_preapproved', ownerId, userId, { email });
    return null;
  });
}

// ── Account deletion (design 14 §8) ─────────────────────────────────────────
// Deleting is two steps: a request locks the account at once (status
// 'deleting': no sign-in to the app, no API access) and the background job's
// purge_deleted_accounts() removes it, with all of its data, after
// DELETION_GRACE_DAYS. Until then the requester can cancel.

async function scheduleDeletion(tx: Tx, userId: string, requestedBy: string, from: AccessStatus) {
  await tx
    .update(users)
    .set({ status: 'deleting', deletionRequestedAt: Date.now(), deletionRequestedBy: requestedBy, statusBeforeDeletion: from })
    .where(eq(users.id, userId));
  await audit(tx, 'account_deletion_requested', requestedBy, userId, {
    by: requestedBy === userId ? 'self' : 'owner',
    graceDays: DELETION_GRACE_DAYS,
  });
}

async function cancelDeletion(tx: Tx, userId: string, cancelledBy: string) {
  const [row] = await tx.select({ before: users.statusBeforeDeletion }).from(users).where(eq(users.id, userId)).limit(1);
  const restored = row?.before === 'suspended' ? 'suspended' : 'active';
  await tx
    .update(users)
    .set({ status: restored, deletionRequestedAt: null, deletionRequestedBy: null, statusBeforeDeletion: null })
    .where(eq(users.id, userId));
  await audit(tx, 'account_deletion_cancelled', cancelledBy, userId, { by: cancelledBy === userId ? 'self' : 'owner', restored });
}

/** A member asks to delete their own account. The owner account can't. Returns an error message, or null. */
export async function requestOwnDeletion(userId: string): Promise<string | null> {
  const result = await withWorker('account_delete', async (tx) => {
    const [me] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me) return 'Account not found';
    if (me.role !== 'member') return 'The owner account cannot be deleted here';
    if (me.status !== 'active') return 'This account cannot be deleted right now';
    await scheduleDeletion(tx, userId, userId, 'active');
    return null;
  });
  forgetAccess(userId);
  return result;
}

/** A member cancels a deletion they requested themselves (from /access). An
 *  owner-requested deletion can only be cancelled by the owner. */
export async function cancelOwnDeletion(userId: string): Promise<string | null> {
  const result = await withWorker('account_delete', async (tx) => {
    const [me] = await tx
      .select({ status: users.status, by: users.deletionRequestedBy })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!me || me.status !== 'deleting') return 'This account is not scheduled for deletion';
    if (me.by !== userId) return 'The owner scheduled this deletion; only the owner can cancel it';
    await cancelDeletion(tx, userId, userId);
    return null;
  });
  forgetAccess(userId);
  return result;
}
