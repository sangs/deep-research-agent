import { NextResponse } from 'next/server';
import { forwardOwnerRequest } from '@/lib/owner-backend-proxy';

// Owner controls for newsletter background summarizing (backend/services/ingest.py):
// GET status · POST settings {enabled} (pause/resume the 30-min sweep) · POST run (sweep now).
const GET_OPS = new Set(['status']);
const POST_OPS = new Set(['settings', 'run']);
const FORBIDDEN = 'Only the owner can control background summarizing';

export async function GET(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!GET_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardOwnerRequest(req, `/ingest/${op}`, FORBIDDEN);
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!POST_OPS.has(op)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return forwardOwnerRequest(req, `/ingest/${op}`, FORBIDDEN);
}
