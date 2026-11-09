import { NextResponse } from 'next/server';
import { isOwner, sessionUser } from '@/lib/user-id';
import { applyOwnerAction, listUsersForOwner, preapproveEmail, type OwnerAction } from '@/lib/users';

// Owner console API. Account + cost only: nothing here reads any user's
// research, digests, sources or email.
const ACTIONS = new Set<OwnerAction>(['approve', 'reject', 'suspend', 'reactivate']);

async function owner() {
  const user = await sessionUser();
  return isOwner(user) ? user : null;
}

// GET /api/admin/users — every account with status and spend.
export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  return NextResponse.json({ users: await listUsersForOwner() });
}

// POST /api/admin/users { action: 'approve'|'reject'|'suspend'|'reactivate', userId }
//                     | { action: 'preapprove', email }
export async function POST(req: Request) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  let error: string | null;
  if (body.action === 'preapprove' && typeof body.email === 'string') {
    error = await preapproveEmail(user.id, body.email);
  } else if (ACTIONS.has(body.action) && typeof body.userId === 'string') {
    error = await applyOwnerAction(user.id, body.userId, body.action);
  } else {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ users: await listUsersForOwner() });
}
