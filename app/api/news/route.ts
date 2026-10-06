import { backendAuthHeaders } from '@/lib/backend-auth';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

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

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();

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
  });
  if (!upstream.ok || !upstream.body) {
    console.error(`[api/news] backend responded ${upstream.status}`);
    return sseError(`News backend error (HTTP ${upstream.status}).`);
  }
  return new Response(upstream.body, { headers: SSE_HEADERS });
}
