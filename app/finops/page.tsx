'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, OctagonAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FinopsDailyChart, providerColor } from '@/components/finops-daily-chart';
import { formatUsd } from '@/lib/usage-client';
import { formatRelativeTime } from '@/lib/date-utils';
import { SOURCE_LABEL, type FinopsSummary } from '@/lib/finops-types';

// Owner-only cost page (design 16 §4A): this product's spend across Google Cloud, OpenRouter and Exa,
// read from its own views in finops-admin. Read only; nothing here changes spend.

function ago(iso: string | null): string {
  return iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : 'never';
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{formatUsd(value)}</p>
      {note && <p className="text-[11px] text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

function ThresholdBar({ pct, threshold, mtd }: { pct: number; threshold: number; mtd: number }) {
  const status = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'good';
  const color = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' }[status];
  const label = { good: 'Within limit', warning: 'Near limit', critical: 'Over limit' }[status];
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span>
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground"> · {formatUsd(mtd)} of {formatUsd(threshold)} this month</span>
        </span>
        <span className="tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.min(100, pct)} aria-label="Share of the monthly limit used">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function FinopsPage() {
  const [data, setData] = useState<FinopsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finops/summary${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? `Could not load costs (HTTP ${res.status})`);
      setData(body as FinopsSummary);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Costs</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to app
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        What this app costs to run, all users together: Google Cloud, OpenRouter and Exa. Months follow Pacific time,
        like Google Cloud invoices. Only you can see this page.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-3 py-2 text-sm">{error}</p>
      )}

      {data?.alerts.map((a) => (
        <p key={a.message} role="status"
           className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
             a.level === 'critical' ? 'border-[#d03b3b]/40 bg-[#d03b3b]/10' : 'border-[#fab219]/40 bg-[#fab219]/10'}`}>
          {a.level === 'critical' ? <OctagonAlert className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          <span className="font-medium">{a.level === 'critical' ? 'Over limit:' : 'Warning:'}</span> {a.message}
        </p>
      ))}

      {!data && !error && <p className="text-sm text-muted-foreground">Loading costs…</p>}

      {data && t && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Today" value={t.today}
                  note={data.live.app_spend_today_utc != null
                    ? `App spend since 00:00 UTC: ${formatUsd(data.live.app_spend_today_utc)} (live)` : undefined} />
            <Tile label="Month to date" value={t.month_to_date} />
            <Tile label="Month-end forecast" value={t.forecast_month_end} note="at this month's daily average" />
            <Tile label="Last month" value={t.last_month} />
          </div>

          <Section title="Monthly limit">
            {t.threshold != null && t.pct_of_threshold != null ? (
              <ThresholdBar pct={t.pct_of_threshold} threshold={t.threshold} mtd={t.month_to_date} />
            ) : (
              <p className="text-sm text-muted-foreground">No limit set: costs are recorded only.</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Emails go to you at 50, 80 and 100% and when the forecast passes the limit. Nothing is stopped
              automatically; the per-user daily budgets and the app-wide daily cap still apply.
            </p>
          </Section>

          <Section title="This month by provider">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-normal pb-2">Provider</th>
                  <th className="text-left font-normal pb-2">Source</th>
                  <th className="text-right font-normal pb-2">Month to date</th>
                </tr>
              </thead>
              <tbody>
                {data.by_provider.map((p) => (
                  <tr key={p.provider} className="border-t border-border/40">
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: providerColor(p.provider) }} aria-hidden />
                        {p.provider}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{p.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')}</td>
                    <td className="py-2 text-right">{formatUsd(p.mtd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.by_gcp_service.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Google Cloud by service:{' '}
                {data.by_gcp_service.map((s) => `${s.service} ${formatUsd(s.mtd)}`).join(' · ')}
              </p>
            )}
          </Section>

          <Section title="Daily, last 30 days">
            <FinopsDailyChart daily={data.daily} />
          </Section>

          <Section title="Data freshness">
            <ul className="space-y-1.5 text-sm">
              {data.sources.map((s) => (
                <li key={s.source} className="flex items-center justify-between gap-3">
                  <span>
                    {s.provider} <span className="text-muted-foreground">· {SOURCE_LABEL[s.source] ?? s.source}</span>
                  </span>
                  <span className={`text-xs ${s.stale ? 'font-medium' : 'text-muted-foreground'}`}>
                    {s.stale && <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" aria-hidden />}
                    {s.stale ? 'Out of date · ' : ''}as of {ago(s.as_of)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-3">
              Google Cloud costs arrive from Google a few times a day; app spend is sent every 30 minutes; totals are
              updated every 4 hours. Page data {data.cached ? 'cached, ' : ''}from {ago(data.generated_at)}.
              {data.untracked_before && ` OpenRouter and Exa spend is recorded from ${data.untracked_before}.`}
              {' '}Not included yet: Vercel and Supabase plans.
            </p>
          </Section>
        </>
      )}
    </main>
  );
}
