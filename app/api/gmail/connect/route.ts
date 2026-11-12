import { NextRequest, NextResponse } from 'next/server';
import { sessionUser } from '@/lib/user-id';
import { gmailAccess } from '@/lib/mailboxes';
import { OAUTH_COOKIE, CALLBACK_PATH, startConnect } from '@/lib/gmail-oauth';

// GET /api/gmail/connect — start "Connect Gmail" (design 15 §4). Separate from sign-in.
export async function GET(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await gmailAccess(user.id)).allowed) {
    return NextResponse.redirect(new URL('/account?gmail_error=not_enabled', req.nextUrl));
  }
  const { url, cookie, maxAgeSeconds } = await startConnect(user.id, user.email, req.nextUrl.origin);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: CALLBACK_PATH,
    maxAge: maxAgeSeconds,
  });
  return res;
}
