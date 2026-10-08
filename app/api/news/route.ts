import { randomUUID } from 'crypto';
import { backendAuthHeaders } from '@/lib/backend-auth';
import { sessionUserId } from '@/lib/user-id';
import { guardRun, recordUsage, type UsageItem } from '@/lib/usage';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8010').replace(/\/+$/, '');

// Large newsletter digests (month range, many senders) can take minutes to
// fetch/cluster/summarize — the backend now streams progress incrementally
// (see backend/main.py), but this route still needs a duration budget wide
// enough that the platform doesn't kill the connection mid-stream.
export const maxDuration = 300;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
};

// The client (useNewsStream) only understands SSE `data:` events, so failures
// before the backend stream starts are reported as a single SSE error event
// instead of a non-SSE body that would leave the panel stuck loading.
function sseError(message: string): Response {
  return new Response(`data: ${JSON.stringify({ type: 'error', message })}\n\n`, { headers: SSE_HEADERS });
}

interface BackendUsageEvent {
  type: 'usage';
  cost_usd: number;
  items: { provider: string; model: string | null; cost_usd: number }[];
}

/** Passes the backend SSE stream through unchanged while remembering the latest
 *  cumulative `usage` event (backend/services/usage.py); `onDone` gets it when
 *  the stream ends or the client disconnects, so a stopped run still records
 *  what it spent. */
function tapUsage(onDone: (usage: BackendUsageEvent | null) => void) {
  const decoder = new TextDecoder();
  let buffer = '';
  let latest: BackendUsageEvent | null = null;
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      onDone(latest);
    }
  };
  return {
    stream: new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || !line.includes('"usage"')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'usage') latest = event;
          } catch {
            // not JSON — ignore
          }
        }
      },
      flush: finish,
    }),
    cancel: finish,
  };
}

export async function POST(req: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const tz: string = body.timezone ?? 'UTC';
  const feature = body.mode === 'newsletter' ? 'newsletter' : 'news';
  const blocked = await guardRun(userId, tz, feature);
  if (blocked) return blocked;

  let authHeaders: Record<string, string>;
  try {
    authHeaders = await backendAuthHeaders(req, BACKEND_URL);
  } catch (e) {
    console.error('[api/news] backend auth failed:', e);
    return sseError('Could not authenticate to the news backend.');
  }

  const upstream = await fetch(`${BACKEND_URL}/digest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!upstream.ok || !upstream.body) {
    console.error(`[api/news] backend responded ${upstream.status}`);
    return sseError(`News backend error (HTTP ${upstream.status}).`);
  }

  const runId = randomUUID();
  const tap = tapUsage((usage) => {
    if (!usage) return;
    const items: UsageItem[] = usage.items.map((i) => ({ provider: i.provider, model: i.model, costUsd: i.cost_usd }));
    recordUsage(userId, tz, feature, runId, items).catch((e) => console.error('[api/news] recording usage failed:', e));
  });
  req.signal.addEventListener('abort', tap.cancel);
  return new Response(upstream.body.pipeThrough(tap.stream), { headers: SSE_HEADERS });
}
