// Server-side user identity, derived from the signed-in session — never from a
// client-supplied value. Each user's data is private to them: every personal
// query filters on this id (design 14, documents/architecture/features).

import { auth } from '@/auth';
import { isPreviewDeployment } from './auth-allowlist';
import { getUserAccess, OWNER_LEGACY_USER_ID, type Role, type UserAccess } from './users';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

/** The signed-in user's account in any status (for /access), or null. */
export async function sessionAccess(): Promise<UserAccess | null> {
  const session = await auth();
  const uid = session?.user?.id;
  return uid ? getUserAccess(uid) : null;
}

/** The signed-in **active** user, or null. Pending and suspended users get null. */
export async function sessionUser(): Promise<SessionUser | null> {
  // Previews (Vercel Authentication-gated, no Google sign-in) act as the owner.
  if (isPreviewDeployment()) return { id: OWNER_LEGACY_USER_ID, email: 'preview-deployment', role: 'owner' };
  const access = await sessionAccess();
  return access?.status === 'active' ? { id: access.id, email: access.email, role: access.role } : null;
}

/** The signed-in active user's id, or null. */
export async function sessionUserId(): Promise<string | null> {
  return (await sessionUser())?.id ?? null;
}

export function isOwner(user: SessionUser | null): boolean {
  return user?.role === 'owner';
}
