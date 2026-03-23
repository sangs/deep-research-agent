'use client';

import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { NewsDashboard, type NewsDigest } from '@/components/news-dashboard';
import { Search, FileText, AlertCircle } from 'lucide-react';

type NewsStreamEvent =
  | { type: 'searching'; query: string }
  | { type: 'results'; count: number; query: string }
  | { type: 'digest'; mode: string; time_range: string; region: string | null; generated_at: string; topics: NewsDigest['topics'] }
  | { type: 'done' }
  | { type: 'error'; message: string };

type Status = 'idle' | 'loading' | 'done' | 'error';

type ThreadEntry = {
  question: string | undefined;
  digest: NewsDigest;
  fromCache: boolean;
};

export type { NewsDigest, ThreadEntry };

export function useNewsStream() {
  const [events, setEvents] = useState<NewsStreamEvent[]>([]);
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref keeps thread current inside async run() and sync stop()/reset()
  const threadRef = useRef<ThreadEntry[]>([]);

  // Derived from latest thread entry
  const currentEntry = thread[thread.length - 1] ?? null;
  const digest = currentEntry?.digest ?? null;
  const fromCache = currentEntry?.fromCache ?? false;

  function _appendToThread(entry: ThreadEntry) {
    const next = [...threadRef.current, entry];
    threadRef.current = next;
    setThread(next);
  }

  function _clearThread() {
    threadRef.current = [];
    setThread([]);
  }

  /** Restore a previously cached digest without calling the backend */
  function restore(cachedDigest: NewsDigest, question?: string) {
    abortRef.current?.abort();
    abortRef.current = null;
    _appendToThread({ question, digest: cachedDigest, fromCache: true });
    setStatus('done');
    setEvents([]);
    setErrorMsg(null);
  }

  /** Stop an in-flight request; keep existing thread results visible */
  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus(threadRef.current.length > 0 ? 'done' : 'idle');
    setEvents([]);
    setErrorMsg(null);
  }

  /** Clear the full conversation thread and return to idle */
  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    _clearThread();
    setStatus('idle');
    setEvents([]);
    setErrorMsg(null);
  }

  async function run(request: {
    question?: string;
    mode: string;
    time_range: string;
    region?: string | null;
    // newsletter-specific (ignored by other modes)
    newsletter_senders?: string;
    newsletter_subject_kw?: string;
    newsletter_by_source?: boolean;
  }) {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setEvents([]);
    setErrorMsg(null);

    // Build conversation history from existing thread so the backend can avoid
    // repeating topics already covered and search for new angles.
    const conversation_history = threadRef.current.map(entry => ({
      question: entry.question,
      topics: entry.digest.topics.map(t => t.label),
    }));

    const fullRequest = conversation_history.length > 0
      ? { ...request, conversation_history }
      : request;

    // Track the digest that arrives during this run so we can append it to the
    // thread on completion (keeping previous entries visible during loading).
    let newDigest: NewsDigest | null = null;
    // If an error event arrives, suppress appending the (empty) digest to the thread
    // so the error message remains visible rather than showing "No results found".
    let hadError = false;

    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullRequest),
        signal: controller.signal,
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const event = JSON.parse(raw) as NewsStreamEvent;

              if (event.type === 'done') {
                if (newDigest && !hadError) {
                  _appendToThread({ question: request.question, digest: newDigest, fromCache: false });
                }
                setStatus(hadError ? 'error' : 'done');
              } else if (event.type === 'error') {
                hadError = true;
                setErrorMsg(event.message);
                setStatus('error');
              } else if (event.type === 'digest') {
                const { type: _, ...digestData } = event;
                newDigest = digestData as NewsDigest;
                setEvents((prev) => [...prev, event]);
              } else {
                setEvents((prev) => [...prev, event]);
              }
            } catch {
              // skip malformed line
            }
          }
        }
      } finally {
        reader.cancel();
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // user stopped — stay as-is
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  return { events, digest, thread, status, errorMsg, fromCache, run, stop, restore, reset };
}

interface NewsDisplayProps {
  events: NewsStreamEvent[];
  digest: NewsDigest | null;
  status: Status;
  errorMsg: string | null;
}

export function NewsDisplay({ events, digest, status, errorMsg }: NewsDisplayProps) {
  const searchEvents = events.filter((e) => e.type === 'searching') as Extract<NewsStreamEvent, { type: 'searching' }>[];
  const resultEvents = events.filter((e) => e.type === 'results') as Extract<NewsStreamEvent, { type: 'results' }>[];

  if (status === 'idle') {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm space-y-1">
        <p>Type a question above or choose filters, then click <strong>Run</strong>.</p>
        <p className="text-xs">Your question overrides the filter defaults.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search progress badges */}
      {(searchEvents.length > 0 || resultEvents.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Search progress
          </p>
          <div className="flex flex-wrap gap-2">
            {searchEvents.map((e, i) => {
              const resultEv = resultEvents[i];
              return (
                <div key={i} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs gap-1 font-normal">
                    <Search className="h-2.5 w-2.5" />
                    {e.query}
                  </Badge>
                  {resultEv && (
                    <Badge variant="secondary" className="text-xs gap-1 font-normal">
                      <FileText className="h-2.5 w-2.5" />
                      {resultEv.count}
                    </Badge>
                  )}
                </div>
              );
            })}
            {status === 'loading' && searchEvents.length === 0 && (
              <Badge variant="outline" className="text-xs animate-pulse">
                Searching…
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && errorMsg && (
        <div className="flex items-center gap-2 text-destructive text-sm border border-destructive/30 rounded-lg p-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Results */}
      {digest && <NewsDashboard digest={digest} />}

      {/* Still loading, no digest yet */}
      {status === 'loading' && !digest && searchEvents.length > 0 && (
        <p className="text-xs text-muted-foreground animate-pulse text-center py-4">
          Grouping topics…
        </p>
      )}
    </div>
  );
}
