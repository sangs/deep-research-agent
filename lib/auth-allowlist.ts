// App-level sign-in allowlist: AUTH_ALLOWED_EMAILS is a comma-separated list of
// Google account emails allowed to use the app. One list for the whole app —
// every allowlisted user currently shares the same data (single-tenant), see
// lib/user-id.ts.

function emailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailList(process.env.AUTH_ALLOWED_EMAILS).includes(email.trim().toLowerCase());
}

/** Owners see account-level information (provider balances). AUTH_OWNER_EMAILS,
 *  defaulting to the first allowlisted email. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
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
