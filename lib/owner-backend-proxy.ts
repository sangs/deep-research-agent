import { NextResponse } from 'next/server';
import { BACKEND_URL, backendAuthHeaders } from '@/lib/backend-auth';
import { userAssertionHeaders } from '@/lib/user-assertion';
import { isOwner, sessionUser, type SessionUser } from '@/lib/user-id';

/** Forwards an owner-only request to a private backend path with the signed
 *  user assertion; the backend takes the actor (audit trail) and the owner check from it.
 *  Used by /api/gmail/[op] and /api/newsletter/ingest/[op]. */
export async function forwardOwnerRequest(
  req: Request,
  backendPath: string,
  forbiddenMessage: string,
): Promise<Response> {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: forbiddenMessage }, { status: 403 });
  let authHeaders: Record<string, string>;
  try {
    authHeaders = { ...(await backendAuthHeaders(req, BACKEND_URL)), ...(await userAssertionHeaders(user)) };
  } catch (e) {
    console.error(`[${backendPath}] backend auth failed:`, e);
    return NextResponse.json({ error: 'Could not authenticate to the backend' }, { status: 502 });
  }
  const init: RequestInit = { method: req.method };
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    init.body = JSON.stringify({ ...body, actor: undefined, user_id: undefined });
  }
  const search = new URL(req.url).search;
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}${backendPath}${search}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });
  } catch (e) {
    // Backend down or unreachable: a clean 502 instead of an unhandled 500.
    console.error(`[${backendPath}] backend unreachable:`, e);
    return NextResponse.json({ error: 'The backend is unavailable. Try again shortly.' }, { status: 502 });
  }
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
}

/** Server-side call to the backend as `user` (signed assertion), e.g. from the
 *  Gmail OAuth callback or a server action. Returns the parsed JSON and status. */
export async function callBackendAsUser(
  user: SessionUser,
  backendPath: string,
  body: object,
  req?: Request,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers = { ...(await backendAuthHeaders(req, BACKEND_URL)), ...(await userAssertionHeaders(user)) };
  const res = await fetch(`${BACKEND_URL}${backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
