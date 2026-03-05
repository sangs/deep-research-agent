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

export function useNewsStream() {
  const [events, setEvents] = useState<NewsStreamEvent[]>([]);
  const [digest, setDigest] = useState<NewsDigest | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setEvents([]);
    setDigest(null);
    setErrorMsg(null);
  }

  async function run(request: { question?: string; mode: string; time_range: string; region?: string | null }) {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setEvents([]);
    setDigest(null);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
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
                setStatus('done');
              } else if (event.type === 'error') {
                setErrorMsg(event.message);
                setStatus('error');
              } else if (event.type === 'digest') {
                const { type: _, ...digestData } = event;
                setDigest(digestData as NewsDigest);
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
      if (e instanceof Error && e.name === 'AbortError') return; // user stopped — stay idle
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  return { events, digest, status, errorMsg, run, stop };
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
