// Env-driven pieces of sign-in. Access itself is owner-approved and lives in the
// database (lib/users.ts); these env vars only bootstrap the migration from the
// single-tenant allowlist era:
// - AUTH_OWNER_EMAILS: the email that claims the migrated owner account at its
//   first sign-in (default: the first AUTH_ALLOWED_EMAILS entry).
// - AUTH_ALLOWED_EMAILS: legacy allowlist. A new account with one of these emails
//   starts active instead of pending. Empty it once Phase A is verified.

function emailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isLegacyAllowedEmail(email: string): boolean {
  return emailList(process.env.AUTH_ALLOWED_EMAILS).includes(email.trim().toLowerCase());
}

export function isOwnerBootstrapEmail(email: string): boolean {
  const owners = emailList(process.env.AUTH_OWNER_EMAILS);
  const effective = owners.length > 0 ? owners : emailList(process.env.AUTH_ALLOWED_EMAILS).slice(0, 1);
  return effective.includes(email.trim().toLowerCase());
}

/** Vercel preview deployments are protected by Vercel Authentication (team
 *  members only) and can't complete Google sign-in (their URLs change per
 *  deployment and Google OAuth doesn't accept wildcard redirect URIs), so app
 *  sign-in is skipped there. VERCEL_ENV is set by the platform, not the client. */
export function isPreviewDeployment(): boolean {
  return process.env.VERCEL_ENV === 'preview';
}
