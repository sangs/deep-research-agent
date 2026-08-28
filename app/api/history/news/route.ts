import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { newsDigests } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';

// Override with NEWS_DIGEST_TTL_SECONDS env var (in Vercel or .env.local). Default: 1 hour.
// Note: changing this only affects new saves — existing cached rows keep their original expires_at.
const DIGEST_TTL_SECONDS = parseInt(process.env.NEWS_DIGEST_TTL_SECONDS ?? '3600', 10);

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

  const { cacheKey, digest, ttlSeconds, mode, locked, label, tags, articleCount, rangeStart, rangeEnd } = await req.json();
  if (!cacheKey || !digest) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Caller can pass ttlSeconds to override the default (e.g. Newsletter uses no-expiry value)
  const effectiveTtl = typeof ttlSeconds === 'number' ? ttlSeconds : DIGEST_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  // Upsert, scoped per user — cacheKey alone is no longer globally unique
  // (two different userIds computing the same key used to silently clobber
  // each other's row; uniqueness is now the composite (userId, cacheKey)).
  await db
    .insert(newsDigests)
    .values({
      id,
      userId,
      cacheKey,
      digest: JSON.stringify(digest),
      mode: mode ?? null,
      locked: !!locked,
      label: label ?? null,
      tags: tags ?? [],
      articleCount: articleCount ?? 0,
      rangeStart: rangeStart ?? null,
      rangeEnd: rangeEnd ?? null,
      generatedAt: now,
      expiresAt: now + effectiveTtl,
    })
    .onConflictDoUpdate({
      target: [newsDigests.userId, newsDigests.cacheKey],
      set: {
        digest: JSON.stringify(digest),
        mode: mode ?? null,
        locked: !!locked,
        label: label ?? null,
        tags: tags ?? [],
        articleCount: articleCount ?? 0,
        rangeStart: rangeStart ?? null,
        rangeEnd: rangeEnd ?? null,
        generatedAt: now,
        expiresAt: now + effectiveTtl,
      },
    });

  return NextResponse.json({ ok: true });
}

// PATCH /api/history/news — rename and/or retag a saved digest (no digest/expiry change).
// Only fields actually present in the request body are updated — omitting `tags` leaves
// existing tags untouched, omitting `label` leaves the existing label untouched.
export async function PATCH(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const body = await req.json();
  const { cacheKey } = body;
  if (!cacheKey) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  const set: { label?: string | null; tags?: string[] } = {};
  if ('label' in body) set.label = body.label ?? null;
  if ('tags' in body) set.tags = body.tags ?? [];
  if (Object.keys(set).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await db
    .update(newsDigests)
    .set(set)
    .where(and(eq(newsDigests.cacheKey, cacheKey), eq(newsDigests.userId, userId)));

  return NextResponse.json({ ok: true });
}

// DELETE /api/history/news?key=... — remove a cached digest (Newsletter unlock / force-refresh)
export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const cacheKey = req.nextUrl.searchParams.get('key');
  if (!cacheKey) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  await db
    .delete(newsDigests)
    .where(and(eq(newsDigests.cacheKey, cacheKey), eq(newsDigests.userId, userId)));

  return NextResponse.json({ ok: true });
}
