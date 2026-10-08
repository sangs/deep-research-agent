import { NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/user-id';
import { checkBudget, FEATURES, type Feature } from '@/lib/usage';

// POST /api/usage/check { feature, tz } — budget pre-check before a run, so the
// UI can ask for consent first. Read-only: doesn't count toward rate limits.
export async function POST(req: Request) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { feature, tz } = await req.json();
  if (!FEATURES.includes(feature)) return NextResponse.json({ error: 'Unknown feature' }, { status: 400 });
  return NextResponse.json(await checkBudget(userId, tz ?? 'UTC', feature as Feature));
}
