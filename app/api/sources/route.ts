import { curatedSources } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db-access';
import { sessionUserId } from '@/lib/user-id';

// Each user's own source lists (seeded from default_sources when their account
// became active). Queries run as that user, so row security keeps them to their own rows.

const LIST_TYPES = ['news_sites', 'research_sites', 'newsletters', 'global_news_sites'] as const;

export async function GET(): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await withUser(userId, (tx) =>
    tx.select().from(curatedSources).where(eq(curatedSources.userId, userId)),
  );
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
  if (action !== 'add' && action !== 'remove') return Response.json({ error: 'Invalid action' }, { status: 400 });
  const now = Date.now();
  const names = (domains as string[]).map((raw) => String(raw).toLowerCase().trim()).filter(Boolean);

  return withUser(userId, async (tx) => {
    const changed: string[] = [];
    for (const domain of names) {
      if (action === 'add') {
        // One row per (user, domain, list_type): the same domain may be in several lists.
        const inserted = await tx
          .insert(curatedSources)
          .values({ id: randomUUID(), userId, domain, listType, addedAt: now })
          .onConflictDoNothing({ target: [curatedSources.userId, curatedSources.domain, curatedSources.listType] })
          .returning({ domain: curatedSources.domain });
        if (inserted.length > 0) changed.push(domain);
      } else {
        // Remove from this list only; other lists keep the domain.
        const deleted = await tx
          .delete(curatedSources)
          .where(and(
            eq(curatedSources.userId, userId),
            eq(curatedSources.domain, domain),
            eq(curatedSources.listType, listType),
          ))
          .returning({ domain: curatedSources.domain });
        if (deleted.length > 0) changed.push(domain);
      }
    }
    const total = (
      await tx
        .select({ id: curatedSources.id })
        .from(curatedSources)
        .where(and(eq(curatedSources.userId, userId), eq(curatedSources.listType, listType)))
    ).length;
    return Response.json({ [action === 'add' ? 'added' : 'removed']: changed, total, list_type: listType });
  });
}
