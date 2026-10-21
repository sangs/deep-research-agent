import { NextResponse } from 'next/server';
import { BACKEND_URL, backendAuthHeaders } from '@/lib/backend-auth';
import { isOwnerEmail } from '@/lib/auth-allowlist';
import { sessionUser } from '@/lib/user-id';

// Proxy to the backend's Gmail organize endpoints. Gmail here is the owner's
// inbox, so only the owner may read labels/activity or change anything. The
// actor recorded in the audit log comes from the session, never the client.
const GET_OPS = new Set(['labels', 'actions']);
const POST_OPS = new Set(['apply', 'undo']);

async function forward(req: Request, op: string, init: RequestInit): Promise<Response> {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: 'Only the inbox owner can organize Gmail' }, { status: 403 });
  let authHeaders: Record<string, string>;
  try {
    authHeaders = await backendAuthHeaders(req, BACKEND_URL);
  } catch (e) {
    console.error('[api/gmail] backend auth failed:', e);
    return NextResponse.json({ error: 'Could not authenticate to the backend' }, { status: 502 });
  }
  const search = new URL(req.url).search;
  const upstream = await fetch(`${BACKEND_URL}/gmail/${op}${search}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
}

export async function GET(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!GET_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forward(req, op, { method: 'GET' });
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!POST_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await sessionUser();
  const body = await req.json().catch(() => ({}));
  return forward(req, op, { method: 'POST', body: JSON.stringify({ ...body, actor: user?.email ?? 'unknown' }) });
}
