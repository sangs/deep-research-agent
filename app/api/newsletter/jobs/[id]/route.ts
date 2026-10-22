import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { ingestJobs } from '@/drizzle/schema';
import { sessionUserId } from '@/lib/user-id';

// GET /api/newsletter/jobs/:id — progress of a newsletter background
// summarizing job (backend/services/ingest.py), polled by useNewsStream.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [job] = await db
    .select({
      status: ingestJobs.status,
      total: ingestJobs.total,
      done: ingestJobs.doneCount,
      failed: ingestJobs.failedCount,
      error: ingestJobs.error,
    })
    .from(ingestJobs)
    .where(and(eq(ingestJobs.id, id), eq(ingestJobs.requestedBy, userId)))
    .limit(1);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(job);
}
