import { NextResponse } from 'next/server';
import { BACKEND_URL, backendAuthHeaders } from '@/lib/backend-auth';
import { isOwner, sessionUser } from '@/lib/user-id';

/** Forwards an owner-only request to a private backend path. POST bodies get
 *  `actor` from the session (never the client) for the backend's audit trail.
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
    authHeaders = await backendAuthHeaders(req, BACKEND_URL);
  } catch (e) {
    console.error(`[${backendPath}] backend auth failed:`, e);
    return NextResponse.json({ error: 'Could not authenticate to the backend' }, { status: 502 });
  }
  const init: RequestInit = { method: req.method };
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    init.body = JSON.stringify({ ...body, actor: user.email ?? 'unknown', user_id: user.id });
  }
  const search = new URL(req.url).search;
  const upstream = await fetch(`${BACKEND_URL}${backendPath}${search}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
}
