import { NextResponse } from 'next/server';
import { forwardOwnerRequest } from '@/lib/owner-backend-proxy';

// Proxy to the backend's Gmail organize endpoints. Gmail here is the owner's
// inbox, so only the owner may read labels/activity or change anything. The
// actor recorded in the audit log comes from the session, never the client.
const GET_OPS = new Set(['labels', 'actions']);
const POST_OPS = new Set(['apply', 'undo']);
const FORBIDDEN = 'Only the inbox owner can organize Gmail';

export async function GET(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!GET_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardOwnerRequest(req, `/gmail/${op}`, FORBIDDEN);
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!POST_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardOwnerRequest(req, `/gmail/${op}`, FORBIDDEN);
}
