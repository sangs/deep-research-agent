import { NextRequest, NextResponse } from 'next/server';
import { sessionUser } from '@/lib/user-id';
import { callBackendAsUser } from '@/lib/owner-backend-proxy';
import { CALLBACK_PATH, ConnectError, OAUTH_COOKIE, exchangeCode, revokeGrant, verifyState } from '@/lib/gmail-oauth';

// GET /api/gmail/oauth/callback — finish "Connect Gmail" (design 15 §4, §12).
// The refresh token passes through memory once, to the backend, and is never stored here.
export async function GET(req: NextRequest) {
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/account?${q}`, req.nextUrl));
    res.cookies.set(OAUTH_COOKIE, '', { path: CALLBACK_PATH, maxAge: 0 });
    return res;
  };
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return done('gmail_error=cancelled');
  const verifier = await verifyState(p.get('state'), req.cookies.get(OAUTH_COOKIE)?.value, user.id);
  const code = p.get('code');
  if (!verifier || !code) return done('gmail_error=bad_state');

  let grant;
  try {
    grant = await exchangeCode(code, verifier, req.nextUrl.origin);
  } catch (e) {
    return done(`gmail_error=${e instanceof ConnectError ? e.code : 'exchange_failed'}`);
  }
  try {
    const { status, data } = await callBackendAsUser(
      user,
      '/gmail/mailbox',
      {
        refresh_token: grant.refreshToken,
        google_sub: grant.googleSub,
        email: grant.email,
        scopes: grant.scopes,
        client_id: grant.clientId,
      },
      req,
    );
    if (status !== 200) {
      await revokeGrant(grant.refreshToken); // refused (wrong account, cap, not enabled): leave no grant behind
      return done(`gmail_error=${encodeURIComponent(String(data.code ?? 'backend_refused'))}`);
    }
  } catch {
    await revokeGrant(grant.refreshToken);
    return done('gmail_error=backend_unavailable');
  }
  return done('gmail=connected');
}
