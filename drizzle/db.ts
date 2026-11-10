// The app's database connection. It logs in as `app_login`, which has no table
// access of its own (drizzle/migrations/0010_rls_roles.sql): every query must
// run inside withUser() / withWorker() from lib/db-access.ts, the only module
// allowed to import this file (tests/db-access-boundary.test.ts).
//
// Connection string: APP_DATABASE_URL when set (local dev, tests), otherwise the
// Secret Manager secret `app-database-url` (Vercel reads it through Workload
// Identity Federation, so no database password is stored in Vercel env vars).
// DATABASE_URL is the postgres (migration) login and is used only by drizzle-kit.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getSecret } from '@/lib/gcp-secrets';
import * as schema from './schema';

export const APP_DATABASE_SECRET = 'app-database-url';

function connect(url: string) {
  // prepare: false — the Supabase pooler runs in transaction mode.
  return drizzle(postgres(url, { prepare: false }), { schema });
}

export type Db = ReturnType<typeof connect>;

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    const url = process.env.APP_DATABASE_URL;
    dbPromise = (url ? Promise.resolve(url) : getSecret(APP_DATABASE_SECRET)).then(connect);
    dbPromise.catch(() => {
      dbPromise = null; // retry on the next call instead of caching the failure
    });
  }
  return dbPromise;
}
