// The only way the app reads or writes the database (server-only).
// Design: documents/architecture/features/14-per-user-data-isolation-design-2026-10-27.md §5.2.
//
// - withUser(userId, fn): runs fn in a transaction as `app_user` with
//   app.user_id set, so Postgres row security limits every query to that
//   user's rows, whatever the query says.
// - withWorker(reason, fn): runs fn as `app_worker` for the few jobs that span
//   users (sign-in, owner console, spend totals, account deletion). That role
//   cannot read anyone's research, digests or sources. The reason shows up as
//   the session's application_name in Postgres.
// Both settings are transaction-local, which is what the Supabase transaction
// pooler requires. Outside these helpers the login role can't touch any table.

import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/drizzle/db';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type WorkerReason =
  | 'sign_in' // resolve a Google sign-in to a user, create access requests
  | 'owner_console' // /admin: list users with spend, approve/suspend/delete members
  | 'app_budget' // app-wide daily spend total across all users
  | 'account_delete' // a member requesting or cancelling deletion of their own account
  | 'retention'; // purges past their retention period

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error('withUser: missing user id');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'app_user', true), set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export async function withWorker<T>(reason: WorkerReason, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('role', 'app_worker', true), set_config('application_name', ${`worker:${reason}`}, true)`,
    );
    return fn(tx);
  });
}
