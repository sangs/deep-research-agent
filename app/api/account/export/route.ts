import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { budgetRaises, curatedSources, newsDigests, researchSessions, usageEvents, users } from '@/drizzle/schema';
import { withUser } from '@/lib/db-access';
import { sessionUserId } from '@/lib/user-id';

// GET /api/account/export — everything the app stores for the signed-in user,
// as one JSON download (design 14 §8). Runs as that user, so row security
// guarantees nothing of anyone else's can be included.
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await withUser(userId, async (tx) => {
    const [account] = await tx
      .select({ email: users.email, name: users.name, role: users.role, createdAt: users.createdAt, approvedAt: users.approvedAt })
      .from(users)
      .where(eq(users.id, userId));
    const research = await tx
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.userId, userId))
      .orderBy(desc(researchSessions.updatedAt));
    const digests = await tx
      .select()
      .from(newsDigests)
      .where(eq(newsDigests.userId, userId))
      .orderBy(desc(newsDigests.generatedAt));
    const sources = await tx
      .select({ domain: curatedSources.domain, listType: curatedSources.listType, addedAt: curatedSources.addedAt })
      .from(curatedSources)
      .where(eq(curatedSources.userId, userId));
    const usage = await tx
      .select({ day: usageEvents.day, feature: usageEvents.feature, provider: usageEvents.provider, model: usageEvents.model, costUsd: usageEvents.costUsd, createdAt: usageEvents.createdAt })
      .from(usageEvents)
      .where(eq(usageEvents.userId, userId))
      .orderBy(desc(usageEvents.createdAt));
    const raises = await tx
      .select({ day: budgetRaises.day, limitUsd: budgetRaises.limitUsd, previousLimitUsd: budgetRaises.previousLimitUsd, createdAt: budgetRaises.createdAt })
      .from(budgetRaises)
      .where(eq(budgetRaises.userId, userId));
    return { account, research, digests, sources, usage, raises };
  });

  const parse = (json: string) => {
    try {
      return JSON.parse(json);
    } catch {
      return json;
    }
  };
  const body = {
    exportedAt: new Date().toISOString(),
    account: data.account,
    researchSessions: data.research.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, messages: parse(r.messages) })),
    digests: data.digests.map((d) => ({
      cacheKey: d.cacheKey,
      label: d.label,
      tags: d.tags,
      mode: d.mode,
      saved: d.locked,
      articleCount: d.articleCount,
      rangeStart: d.rangeStart,
      rangeEnd: d.rangeEnd,
      generatedAt: d.generatedAt,
      digest: parse(d.digest),
    })),
    sources: data.sources,
    usage: data.usage,
    budgetRaises: data.raises,
  };
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="research-suite-export-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
