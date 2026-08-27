import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { newsDigests } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

function getUserId(req: NextRequest): string | null {
  return req.headers.get('X-User-Id');
}

// GET /api/history/news/list?mode=newsletter&limit=20&offset=0 — lightweight
// metadata for the Saved Digests picker. Never touches the `digest` JSON
// blob column, so the list stays cheap even with hundreds of saved digests.
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ items: [], hasMore: false });

  const mode = req.nextUrl.searchParams.get('mode') ?? 'newsletter';
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10) || 20, 50);
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const rows = await db
    .select({
      cacheKey: newsDigests.cacheKey,
      label: newsDigests.label,
      locked: newsDigests.locked,
      articleCount: newsDigests.articleCount,
      rangeStart: newsDigests.rangeStart,
      rangeEnd: newsDigests.rangeEnd,
      generatedAt: newsDigests.generatedAt,
    })
    .from(newsDigests)
    .where(and(eq(newsDigests.userId, userId), eq(newsDigests.mode, mode), eq(newsDigests.locked, true)))
    .orderBy(desc(newsDigests.generatedAt))
    .limit(limit + 1)
    .offset(offset);

  return NextResponse.json({ items: rows.slice(0, limit), hasMore: rows.length > limit });
}
