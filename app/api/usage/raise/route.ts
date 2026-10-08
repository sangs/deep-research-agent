import { NextResponse } from 'next/server';
import { sessionUser } from '@/lib/user-id';
import { raiseDailyBudget, usageSummary } from '@/lib/usage';

// POST /api/usage/raise { limitUsd, tz, consent: true } — raise today's limit
// (up to the configured maximum). Recorded with the approving email; expires
// at the user's local midnight.
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { limitUsd, tz, consent } = await req.json();
  if (consent !== true) return NextResponse.json({ error: 'Explicit consent is required' }, { status: 400 });
  const error = await raiseDailyBudget(user.id, user.email, tz ?? 'UTC', Number(limitUsd));
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(await usageSummary(user.id, tz ?? 'UTC'));
}
