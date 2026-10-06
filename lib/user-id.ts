// Server-side user identity for /api/history/* routes, derived from the signed-in
// session — never from a client-supplied header (the old X-User-Id header and
// this fixed UUID were both public).
//
// The app is single-tenant today (one shared Gmail account): every allowlisted
// user maps to the same fixed identity that all existing saved digests and
// research sessions are stored under (consolidated 2026-08-28). Real per-user
// ids replace this when multi-user support lands — see
// documents/multi_user_auth_payments_roadmap.md ("claim your existing data").

import { auth } from '@/auth';
import { isAllowedEmail, isPreviewDeployment } from './auth-allowlist';

const FIXED_USER_ID = '32087c9e-d37e-4b7c-896e-58da85f4d108';

/** The signed-in user's id, or null when there is no allowlisted session. */
export async function sessionUserId(): Promise<string | null> {
  if (isPreviewDeployment()) return FIXED_USER_ID; // previews: Vercel Authentication gates access
  const session = await auth();
  return isAllowedEmail(session?.user?.email) ? FIXED_USER_ID : null;
}
