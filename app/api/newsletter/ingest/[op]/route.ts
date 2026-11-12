import { NextResponse } from 'next/server';
import { forwardOwnerRequest, forwardUserRequest } from '@/lib/owner-backend-proxy';

// Newsletter background summarizing (backend/services/ingest.py):
// GET status — the caller's own mailbox (owner: plus app-wide figures);
// POST settings {enabled} (global pause) · POST run (sweep every mailbox now) — owner only.
// Each user pauses their own mailbox on /account.
const POST_OPS = new Set(['settings', 'run']);
const FORBIDDEN = 'Only the owner can control background summarizing for everyone';

export async function GET(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (op !== 'status') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardUserRequest(req, '/ingest/status');
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!POST_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardOwnerRequest(req, `/ingest/${op}`, FORBIDDEN);
}
