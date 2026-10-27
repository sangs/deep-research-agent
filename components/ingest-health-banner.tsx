'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

/** Newsletter tab warning when the scheduled background summarizing is failing
 *  (e.g. the Gmail token expired). Owner-only status; renders nothing for
 *  anyone else or while everything is healthy. */
export function IngestHealthBanner() {
  const [problem, setProblem] = useState<{ since: number; error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/newsletter/ingest/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s?.failing_since && s.last_sweep?.error) {
          setProblem({ since: s.failing_since, error: s.last_sweep.error });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!problem) return null;
  return (
    <div role="alert" className="flex items-start gap-2 text-xs rounded-md border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-2.5 py-1.5">
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-[#d03b3b]" />
      <span>
        <span className="font-medium">Background summarizing has been failing since {new Date(problem.since).toLocaleString()}.</span>{' '}
        {problem.error} Runs may be slow until it&apos;s fixed.
      </span>
    </div>
  );
}
