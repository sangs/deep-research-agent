'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Table2, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBudgetGate, useUsage } from '@/components/budget-gate';
import { formatResetTime, formatUsd, usageLevel, type UsageSummary } from '@/lib/usage-client';

// Single data series → one hue (categorical slot 1), stepped per theme. Status colors are reserved for the budget state.
const SERIES = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const STATUS: Record<string, string> = { ok: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };
const STATUS_LABEL: Record<string, string> = { ok: 'Within budget', warning: 'Approaching limit', critical: 'Limit reached' };

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TodayCard({ s }: { s: UsageSummary }) {
  const { openRaiseDialog } = useBudgetGate();
  const level = usageLevel(s.spentUsd, s.limitUsd);
  const pct = Math.min(100, (s.spentUsd / s.limitUsd) * 100);
  const raised = s.limitUsd > s.defaultLimitUsd;
  return (
    <Section title="Today">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="text-5xl font-semibold tracking-tight">{formatUsd(s.spentUsd)}</span>
        <span className="text-muted-foreground pb-1.5">
          of {formatUsd(s.limitUsd)} {raised && <>(raised from {formatUsd(s.defaultLimitUsd)})</>}
        </span>
      </div>
      <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${STATUS[level]}33` }} aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS[level] }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{STATUS_LABEL[level]}</span> · resets at {formatResetTime(s.resetsAt)} ({s.timeZone})
          {raised && <> · the raise expires then</>}
        </span>
        {s.limitUsd < s.maxLimitUsd ? (
          <Button size="sm" variant="outline" onClick={openRaiseDialog}>
            Raise today’s limit (max {formatUsd(s.maxLimitUsd)})
          </Button>
        ) : (
          <span className="text-muted-foreground">At the maximum daily limit</span>
        )}
      </div>
    </Section>
  );
}

function ByFeature({ s }: { s: UsageSummary }) {
  const max = Math.max(...s.byFeature.map((f) => f.spentUsd), 0.0001);
  return (
    <Section title="Today by feature">
      <ul className="space-y-3">
        {s.byFeature.map((f) => (
          <li key={f.feature} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
            <span>{f.label}</span>
            <span className="h-3 rounded-r-[4px] bg-muted/50">
              {f.spentUsd > 0 && (
                <span className={`block h-full rounded-r-[4px] ${SERIES}`} style={{ width: `${(f.spentUsd / max) * 100}%` }} />
              )}
            </span>
            <span className="tabular-nums text-right text-muted-foreground">
              <span className="text-foreground font-medium">{formatUsd(f.spentUsd)}</span> · {f.runs} run{f.runs === 1 ? '' : 's'} · ~
              {formatUsd(f.estimateUsd)}/run
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Last30Days({ s }: { s: UsageSummary }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...s.last30Days.map((d) => d.spentUsd), s.defaultLimitUsd) * 1.15;
  const limitPct = (s.defaultLimitUsd / top) * 100;
  const label = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const total = s.last30Days.reduce((sum, d) => sum + d.spentUsd, 0);

  return (
    <Section
      title={`Last 30 days · ${formatUsd(total)} total`}
      aside={
        <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
          {table ? 'Chart' : 'Table'}
        </Button>
      }
    >
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr><th className="font-normal py-1">Day</th><th className="font-normal py-1 text-right">Spend</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {[...s.last30Days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-border/40">
                  <td className="py-1">{label(d.day)}</td>
                  <td className="py-1 text-right">{formatUsd(d.spentUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative h-48 pl-10" onMouseLeave={() => setHover(null)}>
          {/* y-axis labels (recessive) */}
          <span className="absolute left-0 top-0 text-[10px] text-muted-foreground tabular-nums">{formatUsd(top)}</span>
          <span className="absolute left-0 bottom-0 text-[10px] text-muted-foreground">$0</span>
          {/* default daily budget reference line */}
          <div className="absolute left-10 right-0 border-t border-dashed border-muted-foreground/60" style={{ bottom: `${limitPct}%` }}>
            <span className="absolute right-0 -top-4 text-[10px] text-muted-foreground">
              Daily budget {formatUsd(s.defaultLimitUsd)}
            </span>
          </div>
          <div className="flex h-full items-end gap-[2px] border-b border-border/60">
            {s.last30Days.map((d, i) => (
              <button
                key={d.day}
                type="button"
                className="relative flex-1 h-full flex items-end focus:outline-none"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${label(d.day)}: ${formatUsd(d.spentUsd)}`}
              >
                <span
                  className={`w-full rounded-t-[4px] ${SERIES} ${hover === i ? 'opacity-80 ring-2 ring-foreground/40' : ''}`}
                  style={{ height: d.spentUsd > 0 ? `max(2px, ${(d.spentUsd / top) * 100}%)` : 0 }}
                />
              </button>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `calc(2.5rem + (100% - 2.5rem) * ${(hover + 0.5) / s.last30Days.length})` }}
            >
              <div className="font-semibold tabular-nums">{formatUsd(s.last30Days[hover].spentUsd)}</div>
              <div className="text-muted-foreground">{label(s.last30Days[hover].day)}</div>
            </div>
          )}
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{label(s.last30Days[0].day)}</span>
            <span>Today</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function RaiseHistory({ s }: { s: UsageSummary }) {
  return (
    <Section title="Budget raises (audit log)">
      {s.raises.length === 0 ? (
        <p className="text-sm text-muted-foreground">No raises yet. Each raise needs explicit approval and expires at midnight.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="font-normal py-1">When</th>
              <th className="font-normal py-1">Limit</th>
              <th className="font-normal py-1">Approved by</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {s.raises.map((r) => (
              <tr key={r.createdAt} className="border-t border-border/40">
                <td className="py-1">{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="py-1">{formatUsd(r.previousLimitUsd)} → {formatUsd(r.limitUsd)}</td>
                <td className="py-1">{r.approvedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

interface ProviderInfo {
  fetchedAt: number;
  openrouter: {
    usageUsd?: number; usageTodayUsd?: number; limitUsd?: number | null; limitRemainingUsd?: number | null;
    creditsPurchasedUsd?: number | null; creditsUsedUsd?: number | null; creditsRemainingUsd?: number | null; error?: string;
  };
  links: { name: string; url: string }[];
}

function ProviderAccounts() {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    fetch('/api/usage/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : (setHidden(true), null)))
      .then((d) => d && setInfo(d))
      .catch(() => setHidden(true));
  }, []);
  if (hidden || !info) return null;
  const or = info.openrouter;
  return (
    <Section title="Provider accounts (owner only, read-only)">
      {or.error ? (
        <p className="text-sm text-muted-foreground">{or.error}</p>
      ) : (
        <>
        {or.creditsRemainingUsd != null && or.creditsRemainingUsd < 2 && (
          <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-3 py-2 text-sm">
            <span aria-hidden>⛔</span>
            <span>
              <span className="font-medium">OpenRouter balance is {or.creditsRemainingUsd <= 0 ? 'exhausted' : 'low'} ({formatUsd(Math.max(0, or.creditsRemainingUsd))} left).</span>{' '}
              AI calls fail when it reaches $0. Add credits at openrouter.ai/settings/credits.
            </span>
          </p>
        )}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><dt className="text-muted-foreground">OpenRouter balance</dt><dd className="font-medium tabular-nums">{or.creditsRemainingUsd == null ? '—' : formatUsd(Math.max(0, or.creditsRemainingUsd))}</dd></div>
          <div><dt className="text-muted-foreground">OpenRouter spend today</dt><dd className="font-medium tabular-nums">{formatUsd(or.usageTodayUsd ?? 0)}</dd></div>
          <div><dt className="text-muted-foreground">OpenRouter spend (all time)</dt><dd className="font-medium tabular-nums">{formatUsd(or.usageUsd ?? 0)}</dd></div>
          <div><dt className="text-muted-foreground">Key credit limit</dt><dd className="font-medium">{or.limitUsd == null ? 'None set ⚠' : formatUsd(or.limitUsd)}</dd></div>
          <div><dt className="text-muted-foreground">Key limit remaining</dt><dd className="font-medium tabular-nums">{or.limitRemainingUsd == null ? '—' : formatUsd(or.limitRemainingUsd)}</dd></div>
        </dl>
        </>
      )}
      {or.limitUsd == null && !or.error && (
        <p className="mt-3 text-sm">
          <span className="font-medium">No hard cap on the OpenRouter key.</span>{' '}
          <span className="text-muted-foreground">Set a credit limit in OpenRouter (Keys) as the last line of defence under this app’s daily budget.</span>
        </p>
      )}
      <ul className="mt-4 space-y-1 text-sm">
        {info.links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
              {l.name} <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Uses only the key this app already has (it can report on itself, not change anything). Provider figures can lag a few minutes and
        include spend outside this app; the budget above counts only this app’s runs. Fetched {new Date(info.fetchedAt).toLocaleTimeString()}.
      </p>
    </Section>
  );
}

interface IngestStatus {
  enabled: boolean;
  updated_by: string | null;
  updated_at: number | null;
  daily_cap_usd: number;
  spent_today_usd: number;
  schedule: string;
  active_jobs: number;
  last_success_at: number | null;
  failing_since: number | null; // set while the latest check failed
  last_sweep: {
    status: string;
    total: number;
    done_count: number;
    failed_count: number;
    error: string | null;
    started_at: number | null;
    finished_at: number | null;
  } | null;
}

const SWEEP_STATUS: Record<string, string> = {
  done: 'finished',
  running: 'running',
  queued: 'waiting to start',
  failed: 'failed',
  capped: 'stopped at the daily cap',
};

/** Owner-only: pause/resume the scheduled newsletter sweep (backend/services/ingest.py). */
function BackgroundSummarizing() {
  const [info, setInfo] = useState<IngestStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/newsletter/ingest/status', { cache: 'no-store' });
      if (!r.ok) return setHidden(true);
      setInfo(await r.json());
    } catch {
      setHidden(true);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function post(op: 'settings' | 'run', body: object, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(`/api/newsletter/ingest/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      await load(); // refresh the section first, so the message never contradicts it
      setMessage(r.ok ? done : d.error ?? `Failed (HTTP ${r.status})`);
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !info) return null;
  const last = info.last_sweep;
  const capPct = Math.min(100, (info.spent_today_usd / info.daily_cap_usd) * 100);
  return (
    <Section
      title="Newsletter background summarizing (owner only)"
      aside={
        <Button
          size="sm"
          variant={info.enabled ? 'outline' : 'default'}
          disabled={busy}
          onClick={() =>
            post('settings', { enabled: !info.enabled }, info.enabled ? 'Paused. Scheduled checks now exit at once.' : 'Resumed.')
          }
        >
          {info.enabled ? 'Pause' : 'Resume'}
        </Button>
      }
    >
      {info.failing_since && last?.error && (
        <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-3 py-2 text-sm">
          <span aria-hidden>⛔</span>
          <span>
            <span className="font-medium">Checks have been failing since {new Date(info.failing_since).toLocaleString()}.</span>{' '}
            {last.error}
            {info.last_success_at && ` Last successful check: ${new Date(info.last_success_at).toLocaleString()}.`}
          </span>
        </p>
      )}
      <p className="text-sm">
        <span className="font-medium">{info.enabled ? 'On' : 'Paused'}</span>
        <span className="text-muted-foreground">
          {info.enabled
            ? `: checks your newsletter senders for new mail ${info.schedule} and summarizes it, so digests open fast.`
            : ': scheduled checks exit without calling Gmail or the AI model. Large Runs you start still summarize in the background.'}
          {info.updated_by && info.updated_at && ` Last changed by ${info.updated_by}, ${new Date(info.updated_at).toLocaleString()}.`}
        </span>
      </p>
      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Scheduled spend today (UTC)</dt>
          <dd className="font-medium tabular-nums">
            {formatUsd(info.spent_today_usd)} of {formatUsd(info.daily_cap_usd)} cap
          </dd>
          <div className="mt-1.5 h-1.5 w-full max-w-56 rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${SERIES}`} style={{ width: `${capPct}%` }} />
          </div>
        </div>
        <div>
          <dt className="text-muted-foreground">Last check</dt>
          <dd className="font-medium">
            {!last
              ? 'None yet'
              : `${last.started_at ? new Date(last.started_at).toLocaleString() : '—'}: ${SWEEP_STATUS[last.status] ?? last.status}, ` +
                (last.status === 'failed' && last.total === 0
                  ? 'before any email was read'
                  : `${last.total === 0 ? 'nothing new' : `${last.done_count} of ${last.total} summarized`}`) +
                (last.failed_count ? ` (${last.failed_count} failed)` : '')}
          </dd>
          {last?.error && <p className="text-xs text-muted-foreground mt-0.5">{last.error}</p>}
        </div>
      </dl>
      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !info.enabled || info.active_jobs > 0}
          onClick={() => post('run', {}, 'Started. Refresh this page in a minute to see the result.')}
        >
          Check now
        </Button>
        {info.active_jobs > 0 && <span className="text-xs text-muted-foreground">A job is running.</span>}
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Emergency stop if the app is down:{' '}
        <code>gcloud scheduler jobs pause newsletter-ingest-every-30-min --location=us-central1</code> (
        <code>resume</code> to restart).
      </p>
    </Section>
  );
}

export default function UsagePage() {
  const summary = useUsage();
  return (
    <main className="container mx-auto max-w-4xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usage &amp; limits</h1>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </div>
      {!summary ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <TodayCard s={summary} />
          <ByFeature s={summary} />
          <Last30Days s={summary} />
          <RaiseHistory s={summary} />
          <Section title="Rate limits">
            <p className="text-sm text-muted-foreground mb-2">
              Protect against loops and accidental floods. They reset every minute and can’t be raised from the app.
            </p>
            <ul className="text-sm space-y-1">
              {summary.rateLimits.map((r) => (
                <li key={r.feature}>
                  {r.label}: <span className="tabular-nums">{r.perMinute}</span> runs per minute
                </li>
              ))}
            </ul>
          </Section>
          <ProviderAccounts />
          <BackgroundSummarizing />
        </>
      )}
    </main>
  );
}
