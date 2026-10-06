import { db } from '@/drizzle/db';
import { curatedSources } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function GET(): Promise<Response> {
  const rows = await db.select().from(curatedSources);
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
  const { action, domains, list_type = 'news_sites' } = await req.json();
  const listType = list_type as string;
  const now = Date.now();

  if (action === 'add') {
    const added: string[] = [];
    for (const raw of domains as string[]) {
      const domain = raw.toLowerCase().trim();
      if (!domain) continue;
      // One row per (domain, list_type): the same domain may be in several lists.
      const inserted = await db.insert(curatedSources)
        .values({ id: randomUUID(), domain, listType, addedAt: now })
        .onConflictDoNothing({ target: [curatedSources.domain, curatedSources.listType] })
        .returning({ domain: curatedSources.domain });
      if (inserted.length > 0) added.push(domain);
    }
    const total = await db.select().from(curatedSources).where(eq(curatedSources.listType, listType));
    return Response.json({ added, total: total.length, list_type: listType });
  }

  if (action === 'remove') {
    const removed: string[] = [];
    for (const raw of domains as string[]) {
      const domain = raw.toLowerCase().trim();
      // Remove from this list only; other lists keep the domain.
      const deleted = await db.delete(curatedSources)
        .where(and(eq(curatedSources.domain, domain), eq(curatedSources.listType, listType)))
        .returning({ domain: curatedSources.domain });
      if (deleted.length > 0) removed.push(domain);
    }
    const total = await db.select().from(curatedSources).where(eq(curatedSources.listType, listType));
    return Response.json({ removed, total: total.length, list_type: listType });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
}
