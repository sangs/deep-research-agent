import { NextResponse } from 'next/server';
import { forwardUserRequest } from '@/lib/owner-backend-proxy';
import { isOwner, sessionUser } from '@/lib/user-id';

// Owner cost summary (design 16 §4A). Anyone else gets 404, so the route's existence isn't revealed;
// the backend checks the owner role again from the signed assertion.
export async function GET(req: Request) {
  if (!isOwner(await sessionUser())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const upstream = await forwardUserRequest(req, '/finops/summary');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}
