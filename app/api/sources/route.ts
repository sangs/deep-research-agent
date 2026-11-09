import { db } from '@/drizzle/db';
import { curatedSources } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/user-id';

// Each user's own source lists (seeded from default_sources when their account
// became active). Every query is scoped to the signed-in user.

const LIST_TYPES = ['news_sites', 'research_sites', 'newsletters', 'global_news_sites'] as const;

async function listSize(userId: string, listType: string): Promise<number> {
  const rows = await db
    .select({ id: curatedSources.id })
    .from(curatedSources)
    .where(and(eq(curatedSources.userId, userId), eq(curatedSources.listType, listType)));
  return rows.length;
}

export async function GET(): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await db.select().from(curatedSources).where(eq(curatedSources.userId, userId));
  const grouped = {
    news_sites: [] as string[],
    research_sites: [] as string[],
    newsletters: [] as string[],
    global_news_sites: [] as string[],
  };
  for (const row of rows) {
    const key = row.listType as keyof typeof grouped;
    if (grouped[key]) grouped[key].push(row.domain);
  }
  return Response.json(grouped);
}

export async function POST(req: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { action, domains, list_type = 'news_sites' } = await req.json();
  const listType = list_type as string;
  if (!(LIST_TYPES as readonly string[]).includes(listType)) {
    return Response.json({ error: 'Invalid list_type' }, { status: 400 });
  }
  if (!Array.isArray(domains)) return Response.json({ error: 'domains must be a list' }, { status: 400 });
  const now = Date.now();

  if (action === 'add') {
    const added: string[] = [];
    for (const raw of domains as string[]) {
      const domain = String(raw).toLowerCase().trim();
      if (!domain) continue;
      // One row per (user, domain, list_type): the same domain may be in several lists.
      const inserted = await db.insert(curatedSources)
        .values({ id: randomUUID(), userId, domain, listType, addedAt: now })
        .onConflictDoNothing({ target: [curatedSources.userId, curatedSources.domain, curatedSources.listType] })
        .returning({ domain: curatedSources.domain });
      if (inserted.length > 0) added.push(domain);
    }
    return Response.json({ added, total: await listSize(userId, listType), list_type: listType });
  }

  if (action === 'remove') {
    const removed: string[] = [];
    for (const raw of domains as string[]) {
      const domain = String(raw).toLowerCase().trim();
      // Remove from this list only; other lists keep the domain.
      const deleted = await db.delete(curatedSources)
        .where(and(
          eq(curatedSources.userId, userId),
          eq(curatedSources.domain, domain),
          eq(curatedSources.listType, listType),
        ))
        .returning({ domain: curatedSources.domain });
      if (deleted.length > 0) removed.push(domain);
    }
    return Response.json({ removed, total: await listSize(userId, listType), list_type: listType });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
}
