'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, OctagonAlert, X } from 'lucide-react';
import { useBudgetGate, useUsage } from '@/components/budget-gate';
import {
  formatResetTime,
  formatUsd,
  usageLevel,
  type UsageLevel,
} from '@/lib/usage-client';

// Reserved status colors (never reused for data series); always paired with an icon + label.
const LEVEL_STYLE: Record<UsageLevel, { color: string; Icon: typeof CheckCircle2; label: string }> = {
  ok: { color: '#0ca30c', Icon: CheckCircle2, label: 'Within budget' },
  warning: { color: '#fab219', Icon: AlertTriangle, label: 'Approaching limit' },
  critical: { color: '#d03b3b', Icon: OctagonAlert, label: 'Limit reached' },
};

/** Top-bar pill: today's spend vs limit; links to the usage page. */
export function UsageMeter() {
  const summary = useUsage();
  if (!summary) return null;
  const level = usageLevel(summary.spentUsd, summary.limitUsd);
  const { color, Icon, label } = LEVEL_STYLE[level];
  const pct = Math.min(100, (summary.spentUsd / summary.limitUsd) * 100);
  return (
    <Link
      href="/usage"
      title={`${label}: ${formatUsd(summary.spentUsd)} of ${formatUsd(summary.limitUsd)} used today. Resets ${formatResetTime(summary.resetsAt)}.`}
      aria-label={`Usage today: ${formatUsd(summary.spentUsd)} of ${formatUsd(summary.limitUsd)}, ${label}. Open usage page.`}
      className="hidden sm:flex items-center gap-2 rounded-full border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} aria-hidden />
      <span className="tabular-nums text-foreground">
        {formatUsd(summary.spentUsd)} <span className="text-muted-foreground">/ {formatUsd(summary.limitUsd)}</span>
      </span>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full" style={{ backgroundColor: `${color}33` }} aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
    </Link>
  );
}

const DISMISS_KEY = 'usage-banner-dismissed';

/** Below the nav: warns at >= 70% of today's limit, blocks-explains at 100%. Dismissible per day + level. */
export function UsageBanner() {
  const { summary, openRaiseDialog } = useBudgetGate();
  // Read once on the client; the banner renders nothing until the usage summary
  // loads client-side, so server and client markup still match.
  const [dismissed, setDismissed] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null; // storage unavailable — banner simply stays visible
    }
  });

  if (!summary) return null;
  const level = usageLevel(summary.spentUsd, summary.limitUsd);
  // The meter turns amber at 70%; the banner only interrupts from 80%.
  if (level === 'ok' || (level === 'warning' && summary.spentUsd / summary.limitUsd < 0.8)) return null;
  const key = `${summary.today}:${level}:${summary.limitUsd}`;
  if (dismissed === key) return null;

  const { color, Icon } = LEVEL_STYLE[level];
  const atMax = summary.limitUsd >= summary.maxLimitUsd;
  const reset = formatResetTime(summary.resetsAt);
  const text =
    level === 'critical'
      ? atMax
        ? `Today’s budget (${formatUsd(summary.limitUsd)}, the maximum) is used up. Paid runs resume after the reset at ${reset}. Saved digests and history still work.`
        : `Today’s budget is used up (${formatUsd(summary.spentUsd)} of ${formatUsd(summary.limitUsd)}). Raise today’s limit to keep running, or wait for the reset at ${reset}.`
      : `You’ve used ${Math.round((summary.spentUsd / summary.limitUsd) * 100)}% of today’s budget (${formatUsd(summary.spentUsd)} of ${formatUsd(summary.limitUsd)}).`;

  return (
    <div role="status" className="border-b border-border/60 bg-muted/40 px-5 py-2 text-sm flex items-center gap-3">
      <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} aria-hidden />
      <span className="flex-1">{text}</span>
      {!atMax && (
        <button type="button" onClick={openRaiseDialog} className="font-medium underline underline-offset-2">
          Raise limit
        </button>
      )}
      <Link href="/usage" className="text-muted-foreground underline underline-offset-2">
        Usage
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDismissed(key);
          try {
            localStorage.setItem(DISMISS_KEY, key);
          } catch {
            // ignore
          }
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
