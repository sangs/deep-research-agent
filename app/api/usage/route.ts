import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/user-id';
import { usageSummary } from '@/lib/usage';

// GET /api/usage?tz=America/New_York — today's spend vs limit, per-feature
// breakdown, last 30 days, raise history, rate limits.
export async function GET(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await usageSummary(userId, req.nextUrl.searchParams.get('tz') ?? 'UTC'));
}
