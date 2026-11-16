'use client';

import { useMemo, useState } from 'react';
import { formatUsd } from '@/lib/usage-client';
import type { FinopsSummary } from '@/lib/finops-types';

// Daily cost, stacked by provider. Colors follow the provider (never its rank); light and dark steps live in
// app/globals.css (--finops-*), validated with the dataviz validate_palette.js against each card surface
// (dark: CVD ΔE 9.4, all >= 3:1; light: CVD ΔE 9.2, Exa 2.8:1, so the legend and table view carry identity).
// A provider beyond these three folds into "Other" (muted), never a generated hue.
export const PROVIDER_COLOR: Record<string, string> = {
  'Google Cloud': 'var(--finops-google-cloud)',
  OpenRouter: 'var(--finops-openrouter)',
  Exa: 'var(--finops-exa)',
};
const OTHER = 'Other';
const OTHER_COLOR = 'var(--muted-foreground)';
const CHART_HEIGHT_PX = 160;

export function providerColor(provider: string): string {
  return PROVIDER_COLOR[provider] ?? OTHER_COLOR;
}

interface Day {
  date: string;
  total: number;
  parts: { provider: string; cost: number }[];
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function FinopsDailyChart({ daily }: { daily: FinopsSummary['daily'] }) {
  const [hover, setHover] = useState<string | null>(null);

  const { days, providers, max } = useMemo(() => {
    const byDate = new Map<string, Map<string, number>>();
    for (const row of daily) {
      const key = row.provider in PROVIDER_COLOR ? row.provider : OTHER;
      const m = byDate.get(row.date) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + row.cost);
      byDate.set(row.date, m);
    }
    const order = [...Object.keys(PROVIDER_COLOR), OTHER];
    const present = order.filter((p) => daily.some((r) => (r.provider in PROVIDER_COLOR ? r.provider : OTHER) === p));
    const days: Day[] = [...byDate.keys()].sort().map((date) => {
      const m = byDate.get(date)!;
      const parts = present.filter((p) => (m.get(p) ?? 0) > 0).map((p) => ({ provider: p, cost: m.get(p)! }));
      return { date, parts, total: parts.reduce((s, p) => s + p.cost, 0) };
    });
    return { days, providers: present, max: Math.max(0.0001, ...days.map((d) => d.total)) };
  }, [daily]);

  if (days.length === 0) return <p className="text-sm text-muted-foreground">No daily costs yet.</p>;

  const active = days.find((d) => d.date === hover);

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground" aria-label="Legend">
        {providers.map((p) => (
          <li key={p} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: providerColor(p) }} aria-hidden />
            {p}
          </li>
        ))}
      </ul>

      <div className="relative">
        <div className="flex items-end gap-[2px] border-b border-border/60" style={{ height: CHART_HEIGHT_PX }}
             role="img" aria-label={`Daily cost for ${days.length} days, stacked by provider; table below`}>
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              onMouseEnter={() => setHover(d.date)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d.date)}
              onBlur={() => setHover(null)}
              aria-label={`${shortDate(d.date)}: ${formatUsd(d.total)}`}
              className={`flex-1 min-w-0 h-full flex flex-col justify-end gap-[2px] rounded-t-[4px] focus:outline-none ${
                hover === d.date ? 'bg-muted/40' : ''
              }`}
            >
              {[...d.parts].reverse().map((p, i) => (
                <span
                  key={p.provider}
                  className={`block w-full ${i === 0 ? 'rounded-t-[4px]' : ''}`}
                  style={{
                    height: `${Math.max(1, (p.cost / max) * (CHART_HEIGHT_PX - 8))}px`,
                    background: providerColor(p.provider),
                  }}
                />
              ))}
            </button>
          ))}
        </div>

        {active && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-2 whitespace-nowrap rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: `${((days.indexOf(active) + 0.5) / days.length) * 100}%`,
              transform: `translate(${days.indexOf(active) > days.length / 2 ? '-100%' : '0'}, -100%)`,
            }}
          >
            <p className="font-medium mb-1">{shortDate(active.date)}</p>
            {active.parts.map((p) => (
              <p key={p.provider} className="flex items-center gap-2 tabular-nums">
                <span className="h-2 w-2 rounded-sm" style={{ background: providerColor(p.provider) }} aria-hidden />
                <span className="text-muted-foreground">{p.provider}</span>
                <span className="ml-auto pl-3">{formatUsd(p.cost)}</span>
              </p>
            ))}
            <p className="flex border-t border-border/60 mt-1 pt-1 font-medium tabular-nums">
              Total <span className="ml-auto pl-3">{formatUsd(active.total)}</span>
            </p>
          </div>
        )}

        <div className="flex justify-between mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span>{shortDate(days[0].date)}</span>
          <span>max {formatUsd(max)}/day</span>
          <span>{shortDate(days[days.length - 1].date)}</span>
        </div>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal py-1">Date</th>
              {providers.map((p) => <th key={p} className="text-right font-normal">{p}</th>)}
              <th className="text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date} className="border-t border-border/40">
                <td className="py-1">{d.date}</td>
                {providers.map((p) => {
                  const c = d.parts.find((x) => x.provider === p)?.cost;
                  return <td key={p} className="text-right">{c ? formatUsd(c) : '—'}</td>;
                })}
                <td className="text-right font-medium">{formatUsd(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
