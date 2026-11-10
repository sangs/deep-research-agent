// Connected Gmail mailboxes, as the web app sees them (Phase C, design 15).
//
// The app reads the user's own mailbox row (row security: app_user sees only
// theirs) and may flip its background-summarizing switch. Connecting,
// disconnecting and every use of the stored Google access go through the
// backend, which alone can read the encrypted credentials.

import { count, eq } from 'drizzle-orm';
import { gmailCapLedger, mailboxes, users } from '@/drizzle/schema';
import { withUser, withWorker } from '@/lib/db-access';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
/** Google's lifetime limit for an unverified app's restricted scope (design 14 §6.1). */
export const GMAIL_CAP_LIMIT = 100;
/** Connecting is refused from here on (decision D2; must match CAP_GUARD in backend/services/mailboxes.py). */
export const GMAIL_CAP_GUARD = 95;

export type MailboxStatus = 'active' | 'reauth_required' | 'disconnected';

export interface MailboxInfo {
  email: string;
  status: MailboxStatus;
  sweepEnabled: boolean;
  connectedAt: number;
  lastSweepAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

export interface GmailAccess {
  /** The owner, or a member the owner turned Gmail on for. */
  allowed: boolean;
  /** Null when never connected. */
  mailbox: MailboxInfo | null;
}

export async function gmailAccess(userId: string): Promise<GmailAccess> {
  return withUser(userId, async (tx) => {
    const [u] = await tx
      .select({ role: users.role, gmailEnabled: users.gmailEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [m] = await tx
      .select({
        email: mailboxes.email,
        status: mailboxes.status,
        sweepEnabled: mailboxes.sweepEnabled,
        connectedAt: mailboxes.connectedAt,
        lastSweepAt: mailboxes.lastSweepAt,
        lastError: mailboxes.lastError,
        lastErrorAt: mailboxes.lastErrorAt,
      })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return {
      allowed: !!u && (u.role === 'owner' || u.gmailEnabled),
      mailbox: m ? { ...m, status: m.status as MailboxStatus } : null,
    };
  });
}

/** True when the user may run Newsletter now: allowed and connected. */
export function gmailReady(access: GmailAccess): boolean {
  return access.allowed && access.mailbox?.status === 'active';
}

/** The user's own pause/resume of background summarizing for their mailbox. */
export async function setSweepEnabled(userId: string, enabled: boolean): Promise<void> {
  await withUser(userId, (tx) =>
    tx.update(mailboxes).set({ sweepEnabled: enabled }).where(eq(mailboxes.userId, userId)),
  );
}

/** Owner console: Google accounts that ever granted Gmail through the app. */
export async function gmailCapUsed(): Promise<number> {
  const [row] = await withWorker('owner_console', (tx) => tx.select({ n: count() }).from(gmailCapLedger));
  return Number(row?.n ?? 0);
}
