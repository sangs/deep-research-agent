import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { researchSessions } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

function getUserId(req: NextRequest): string | null {
  return req.headers.get('X-User-Id');
}

// GET /api/history/research/[id] — load full messages for one session
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const { id } = await params;
  const rows = await db
    .select({ messages: researchSessions.messages })
    .from(researchSessions)
    .where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)))
    .limit(1);

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ messages: JSON.parse(rows[0].messages) });
}

// DELETE /api/history/research/[id] — delete a session
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const { id } = await params;
  await db
    .delete(researchSessions)
    .where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)));

  return NextResponse.json({ ok: true });
}
