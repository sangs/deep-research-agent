import { NextResponse } from 'next/server';
import { forwardUserRequest } from '@/lib/owner-backend-proxy';

// Proxy to the backend's Gmail endpoints (Phase C): each user acts on their own
// connected mailbox only; the backend takes the user and the actor recorded in
// the audit log from the signed assertion, never from the client.
//   GET labels | actions · POST apply | undo | disconnect
const GET_OPS = new Set(['labels', 'actions']);
const POST_OPS: Record<string, string> = {
  apply: '/gmail/apply',
  undo: '/gmail/undo',
  disconnect: '/gmail/mailbox/disconnect',
};

export async function GET(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!GET_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardUserRequest(req, `/gmail/${op}`);
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  const path = POST_OPS[op];
  if (!path) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardUserRequest(req, path);
}
