import { NextResponse } from 'next/server';
import { isOwner, sessionUser } from '@/lib/user-id';
import { applyOwnerAction, listUsersForOwner, preapproveEmail, type OwnerAction } from '@/lib/users';
import { GMAIL_CAP_GUARD, GMAIL_CAP_LIMIT, gmailCapUsed } from '@/lib/mailboxes';

async function listing() {
  return {
    users: await listUsersForOwner(),
    gmailCap: { used: await gmailCapUsed(), limit: GMAIL_CAP_LIMIT, guard: GMAIL_CAP_GUARD },
  };
}

// Owner console API. Account + cost only: nothing here reads any user's
// research, digests, sources or email.
const ACTIONS = new Set<OwnerAction>([
  'approve', 'reject', 'suspend', 'reactivate', 'delete', 'cancel_deletion', 'enable_gmail', 'disable_gmail',
]);

async function owner() {
  const user = await sessionUser();
  return isOwner(user) ? user : null;
}

// GET /api/admin/users — every account with status, spend and Gmail switch; the Gmail cap count.
export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  return NextResponse.json(await listing());
}

// POST /api/admin/users { action: 'approve'|'reject'|'suspend'|'reactivate'|'delete'|'cancel_deletion'|'enable_gmail'|'disable_gmail', userId }
// 'delete' schedules the deletion (30-day grace period, design 14 §8).
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
  return NextResponse.json(await listing());
}
