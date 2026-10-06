// Auth.js: Google sign-in restricted to the AUTH_ALLOWED_EMAILS allowlist.
// The OAuth client secret and session-signing key are read from GCP Secret
// Manager at runtime (lib/gcp-secrets.ts) — they are not Vercel env vars.

import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { NextResponse } from 'next/server';
import { getSecret } from '@/lib/gcp-secrets';
import { isAllowedEmail, isPreviewDeployment } from '@/lib/auth-allowlist';

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const [clientSecret, secret] = await Promise.all([
    getSecret('auth-google-client-secret'),
    getSecret('auth-session-secret'),
  ]);
  return {
    secret,
    trustHost: true,
    session: { strategy: 'jwt' },
    providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret })],
    callbacks: {
      // Only verified, allowlisted Google accounts may sign in.
      signIn({ profile }) {
        return profile?.email_verified === true && isAllowedEmail(profile.email);
      },
      // Runs in proxy.ts for every matched request. Re-checks the allowlist so
      // removing an email revokes existing sessions too.
      authorized({ auth: session, request }) {
        if (isPreviewDeployment()) return true;
        if (isAllowedEmail(session?.user?.email)) return true;
        if (request.nextUrl.pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return false; // pages: redirect to the sign-in page
      },
    },
  };
});
