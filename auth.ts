// Auth.js: Google sign-in with owner-approved access (lib/users.ts).
// Any verified Google account may sign in; an unknown one becomes a pending
// access request and only reaches /access until the owner approves it.
// The OAuth client secret and session-signing key are read from GCP Secret
// Manager at runtime (lib/gcp-secrets.ts) — they are not Vercel env vars.

import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { NextResponse } from 'next/server';
import { getSecret } from '@/lib/gcp-secrets';
import { isPreviewDeployment } from '@/lib/auth-allowlist';
import { getUserAccess, resolveSignIn, userIdForGoogleSubject } from '@/lib/users';

const PUBLIC_PATHS = new Set(['/privacy']);
/** Where pending / suspended users land (app/access/page.tsx). */
export const ACCESS_PATH = '/access';

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const [clientSecret, secret] = await Promise.all([
    getSecret('auth-google-client-secret'),
    getSecret('auth-session-secret'),
  ]);
  return {
    secret,
    trustHost: true,
    session: { strategy: 'jwt' },
    // Sign-in asks only for openid/email/profile. Gmail access is a separate,
    // per-user consent (design 14, Phase C).
    providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret })],
    callbacks: {
      // Verified Google accounts only. Creates an access request for unknown ones.
      async signIn({ account, profile }) {
        if (account?.provider !== 'google' || !account.providerAccountId) return false;
        if (profile?.email_verified !== true || !profile.email) return false;
        const result = await resolveSignIn(account.providerAccountId, profile.email, profile.name ?? null);
        if (result.ok) return true;
        console.warn(`[auth] sign-in refused: ${result.reason}`);
        return false;
      },
      // The session token carries the internal user id, never trusted from the client.
      async jwt({ token, account }) {
        if (account?.provider === 'google' && account.providerAccountId) {
          token.uid = (await userIdForGoogleSubject(account.providerAccountId)) ?? undefined;
        }
        return token;
      },
      session({ session, token }) {
        if (typeof token.uid === 'string') session.user.id = token.uid;
        return session;
      },
      // Runs in proxy.ts for every matched request. Reads the user's current
      // status (cached 30 s), so approval and suspension apply to live sessions.
      async authorized({ auth: session, request }) {
        if (isPreviewDeployment()) return true;
        const path = request.nextUrl.pathname;
        if (PUBLIC_PATHS.has(path)) return true;
        const isApi = path.startsWith('/api/');
        const uid = session?.user?.id;
        const access = uid ? await getUserAccess(uid) : null;
        if (!access) {
          return isApi ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) : false; // pages: sign-in
        }
        if (access.status === 'active') {
          return path === ACCESS_PATH ? NextResponse.redirect(new URL('/', request.nextUrl)) : true;
        }
        if (path === ACCESS_PATH) return true;
        if (isApi) return NextResponse.json({ error: `access_${access.status}` }, { status: 403 });
        return NextResponse.redirect(new URL(ACCESS_PATH, request.nextUrl));
      },
    },
  };
});
