import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { newsDigests } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';

const DIGEST_TTL_SECONDS = 3600; // 1 hour

function getUserId(req: NextRequest): string | null {
  return req.headers.get('X-User-Id');
}

// GET /api/history/news?key=... — load cached digest if fresh
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ digest: null });

  const cacheKey = req.nextUrl.searchParams.get('key');
  if (!cacheKey) return NextResponse.json({ digest: null });

  const now = Math.floor(Date.now() / 1000);

  const rows = await db
    .select({ digest: newsDigests.digest })
    .from(newsDigests)
    .where(
      and(
        eq(newsDigests.cacheKey, cacheKey),
        eq(newsDigests.userId, userId),
        gt(newsDigests.expiresAt, now)
      )
    )
    .limit(1);

  if (rows.length === 0) return NextResponse.json({ digest: null });

  return NextResponse.json({ digest: JSON.parse(rows[0].digest) });
}

// POST /api/history/news — save a digest
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const { cacheKey, digest } = await req.json();
  if (!cacheKey || !digest) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  // Upsert — replace if same cache key exists
  await db
    .insert(newsDigests)
    .values({
      id,
      userId,
      cacheKey,
      digest: JSON.stringify(digest),
      generatedAt: now,
      expiresAt: now + DIGEST_TTL_SECONDS,
    })
    .onConflictDoUpdate({
      target: newsDigests.cacheKey,
      set: {
        digest: JSON.stringify(digest),
        generatedAt: now,
        expiresAt: now + DIGEST_TTL_SECONDS,
      },
    });

  return NextResponse.json({ ok: true });
}
