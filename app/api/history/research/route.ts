import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { researchSessions } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sessionUserId } from '@/lib/user-id';


// GET /api/history/research — list sessions for this user
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json([], { status: 200 });

  const rows = await db
    .select({
      id: researchSessions.id,
      title: researchSessions.title,
      createdAt: researchSessions.createdAt,
      updatedAt: researchSessions.updatedAt,
    })
    .from(researchSessions)
    .where(eq(researchSessions.userId, userId))
    .orderBy(desc(researchSessions.updatedAt))
    .limit(50);

  return NextResponse.json(rows);
}

// POST /api/history/research — upsert a session
export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const { id, title, messages } = await req.json();
  if (!id || !title || !messages) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const messagesJson = JSON.stringify(messages);

  // Check if session already exists for this user
  const existing = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(researchSessions)
      .set({ messages: messagesJson, title, updatedAt: now })
      .where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)));
  } else {
    await db.insert(researchSessions).values({
      id,
      userId,
      title,
      messages: messagesJson,
      createdAt: now,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/history/research — delete ALL sessions for this user (bulk clear)
export async function DELETE() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  await db.delete(researchSessions).where(eq(researchSessions.userId, userId));

  return NextResponse.json({ ok: true });
}
