'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBrowserTimezone } from '@/lib/date-utils';
import type { BudgetCheck, Feature, UsageSummary } from '@/lib/usage';

export type { BudgetCheck, Feature, UsageSummary };

const USAGE_CHANGED = 'usage:changed';

/** Tell every usage view to refresh (after a run finishes or the limit changes). */
export function notifyUsageChanged() {
  window.dispatchEvent(new Event(USAGE_CHANGED));
}

export async function fetchUsageSummary(): Promise<UsageSummary | null> {
  const res = await fetch(`/api/usage?tz=${encodeURIComponent(getBrowserTimezone())}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

export async function checkBudget(feature: Feature): Promise<BudgetCheck | null> {
  const res = await fetch('/api/usage/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, tz: getBrowserTimezone() }),
  });
  return res.ok ? res.json() : null;
}

export async function raiseBudget(limitUsd: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/usage/raise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limitUsd, tz: getBrowserTimezone(), consent: true }),
  });
  if (res.ok) {
    notifyUsageChanged();
    return { ok: true };
  }
  const body = await res.json().catch(() => ({}));
  return { ok: false, error: body.error ?? `HTTP ${res.status}` };
}

/** Live usage summary: refreshes on usage:changed, window focus, and every minute. */
export function useUsageSummary() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const refresh = useCallback(() => {
    fetchUsageSummary().then((s) => s && setSummary(s)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener(USAGE_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(USAGE_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { summary, refresh };
}

export type UsageLevel = 'ok' | 'warning' | 'critical';

/** good < 70%, warning 70–99%, critical >= 100% of today's limit. */
export function usageLevel(spentUsd: number, limitUsd: number): UsageLevel {
  const ratio = limitUsd > 0 ? spentUsd / limitUsd : 1;
  if (ratio >= 1) return 'critical';
  if (ratio >= 0.7) return 'warning';
  return 'ok';
}

export function formatUsd(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;
}

/** "12:00 AM" style reset time in the browser's timezone. */
export function formatResetTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Human message for the JSON errors /api/news and /api/research return when a run is blocked. */
export function blockedRunMessage(body: { error?: string; retryAfterSeconds?: number }): string | null {
  if (body.error === 'rate_limited') return `Too many requests. Try again in ${body.retryAfterSeconds ?? 60}s.`;
  if (body.error === 'budget_exceeded') return "Today's usage budget is used up. Raise today's limit from the usage meter, or wait for the reset at midnight.";
  return null;
}
