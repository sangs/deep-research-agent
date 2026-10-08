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
  openrouter: { usageUsd?: number; usageTodayUsd?: number; limitUsd?: number | null; limitRemainingUsd?: number | null; error?: string };
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
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><dt className="text-muted-foreground">OpenRouter spend today</dt><dd className="font-medium tabular-nums">{formatUsd(or.usageTodayUsd ?? 0)}</dd></div>
          <div><dt className="text-muted-foreground">OpenRouter spend (all time)</dt><dd className="font-medium tabular-nums">{formatUsd(or.usageUsd ?? 0)}</dd></div>
          <div><dt className="text-muted-foreground">Key credit limit</dt><dd className="font-medium">{or.limitUsd == null ? 'None set ⚠' : formatUsd(or.limitUsd)}</dd></div>
          <div><dt className="text-muted-foreground">Remaining</dt><dd className="font-medium tabular-nums">{or.limitRemainingUsd == null ? '—' : formatUsd(or.limitRemainingUsd)}</dd></div>
        </dl>
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
        </>
      )}
    </main>
  );
}
