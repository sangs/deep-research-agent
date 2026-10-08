// Usage limits (server-only): daily spend budget + per-minute rate limits.
//
// - Spend is the *actual* cost the providers report per run (OpenRouter
//   usage.cost, Exa costDollars), recorded in usage_events against the user's
//   local calendar day.
// - Daily budget: USAGE_DAILY_BUDGET_USD (default $2). The user may raise
//   today's limit up to USAGE_MAX_DAILY_BUDGET_USD (default $5) with explicit
//   consent; every raise is recorded in budget_raises and expires at local midnight.
// - A run is allowed when spent + estimate <= today's limit. Runs are never
//   stopped part-way; the check happens before each run.
// - Rate limits are fixed one-minute windows in Postgres so every server
//   instance shares them. They can't be raised from the UI.

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { budgetRaises, rateLimitCounters, usageEvents } from '@/drizzle/schema';
import { dayKeyInTimeZone, nextMidnightInTimeZone, resolveTimeZone } from '@/lib/date-utils';

export type Feature = 'deep_research' | 'news' | 'newsletter';
export const FEATURES: Feature[] = ['deep_research', 'news', 'newsletter'];

export const FEATURE_LABELS: Record<Feature, string> = {
  deep_research: 'Deep Research',
  news: 'News Hub',
  newsletter: 'Newsletter',
};

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_DAILY_BUDGET_USD = envNumber('USAGE_DAILY_BUDGET_USD', 2);
export const MAX_DAILY_BUDGET_USD = envNumber('USAGE_MAX_DAILY_BUDGET_USD', 5);

/** Requests per minute per user, per feature. */
export const RATE_LIMITS: Record<Feature, number> = { deep_research: 5, news: 10, newsletter: 2 };

/** Used until there are recent runs to average (observed 2026-10-08: a News run ≈ $0.055). */
const FALLBACK_ESTIMATE_USD: Record<Feature, number> = { deep_research: 0.05, news: 0.06, newsletter: 0.1 };

export interface UsageItem {
  provider: string;
  model: string | null;
  costUsd: number;
}

export async function recordUsage(userId: string, tz: string, feature: Feature, runId: string, items: UsageItem[]) {
  const rows = items
    .filter((i) => i.costUsd > 0)
    .map((i) => ({
      id: randomUUID(),
      userId,
      day: dayKeyInTimeZone(tz),
      feature,
      provider: i.provider,
      model: i.model,
      costUsd: i.costUsd,
      runId,
      createdAt: Date.now(),
    }));
  if (rows.length > 0) await db.insert(usageEvents).values(rows);
}

async function spentOn(userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.day, day)));
  return Number(row?.total ?? 0);
}

async function limitOn(userId: string, day: string): Promise<number> {
  const [raise] = await db
    .select({ limitUsd: budgetRaises.limitUsd })
    .from(budgetRaises)
    .where(and(eq(budgetRaises.userId, userId), eq(budgetRaises.day, day)))
    .orderBy(desc(budgetRaises.createdAt))
    .limit(1);
  // A raise can only add headroom: never below the default (e.g. if the default
  // was increased after a raise was recorded).
  return Math.max(raise?.limitUsd ?? 0, DEFAULT_DAILY_BUDGET_USD);
}

/** Average actual cost of the user's last 10 runs of `feature` (fallback until there's history). */
export async function estimateRunCost(userId: string, feature: Feature): Promise<number> {
  const runs = await db
    .select({ runId: usageEvents.runId, cost: sql<number>`sum(${usageEvents.costUsd})` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.feature, feature)))
    .groupBy(usageEvents.runId)
    .orderBy(desc(sql`max(${usageEvents.createdAt})`))
    .limit(10);
  if (runs.length === 0) return FALLBACK_ESTIMATE_USD[feature];
  return runs.reduce((sum, r) => sum + Number(r.cost), 0) / runs.length;
}

export interface BudgetCheck {
  allowed: boolean;
  spentUsd: number;
  limitUsd: number;
  estimateUsd: number;
  defaultLimitUsd: number;
  maxLimitUsd: number;
  resetsAt: number; // epoch ms, next local midnight
  timeZone: string;
}

export async function checkBudget(userId: string, tz: string, feature: Feature): Promise<BudgetCheck> {
  const zone = resolveTimeZone(tz);
  const day = dayKeyInTimeZone(zone);
  const [spentUsd, limitUsd, estimateUsd] = await Promise.all([
    spentOn(userId, day),
    limitOn(userId, day),
    estimateRunCost(userId, feature),
  ]);
  return {
    allowed: spentUsd + estimateUsd <= limitUsd,
    spentUsd,
    limitUsd,
    estimateUsd,
    defaultLimitUsd: DEFAULT_DAILY_BUDGET_USD,
    maxLimitUsd: MAX_DAILY_BUDGET_USD,
    resetsAt: nextMidnightInTimeZone(zone),
    timeZone: zone,
  };
}

/** Raise today's limit (consent required by the caller). Returns an error message if invalid. */
export async function raiseDailyBudget(userId: string, email: string, tz: string, newLimitUsd: number): Promise<string | null> {
  const day = dayKeyInTimeZone(tz);
  const current = await limitOn(userId, day);
  if (!Number.isFinite(newLimitUsd)) return 'Invalid amount';
  if (newLimitUsd <= current) return `Today's limit is already $${current.toFixed(2)}`;
  if (newLimitUsd > MAX_DAILY_BUDGET_USD) return `The maximum daily limit is $${MAX_DAILY_BUDGET_USD.toFixed(2)}`;
  await db.insert(budgetRaises).values({
    id: randomUUID(),
    userId,
    day,
    limitUsd: newLimitUsd,
    previousLimitUsd: current,
    approvedBy: email,
    createdAt: Date.now(),
  });
  return null;
}

/** Fixed one-minute window counter; returns seconds to wait when over the limit. */
export async function checkRateLimit(userId: string, feature: Feature): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - (nowSec % 60);
  const [row] = await db
    .insert(rateLimitCounters)
    .values({ userId, bucket: feature, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.userId, rateLimitCounters.bucket, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });
  if (row.count <= RATE_LIMITS[feature]) return { ok: true };
  return { ok: false, retryAfterSeconds: windowStart + 60 - nowSec };
}

/** Run both checks before a paid run. Returns a Response to send back when blocked, else null. */
export async function guardRun(userId: string, tz: string, feature: Feature): Promise<Response | null> {
  const rate = await checkRateLimit(userId, feature);
  if (!rate.ok) {
    return Response.json(
      { error: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }
  const budget = await checkBudget(userId, tz, feature);
  if (!budget.allowed) return Response.json({ error: 'budget_exceeded', ...budget }, { status: 402 });
  return null;
}

export interface UsageSummary {
  timeZone: string;
  today: string;
  spentUsd: number;
  limitUsd: number;
  defaultLimitUsd: number;
  maxLimitUsd: number;
  resetsAt: number;
  byFeature: { feature: Feature; label: string; spentUsd: number; runs: number; estimateUsd: number }[];
  last30Days: { day: string; spentUsd: number }[];
  raises: { day: string; limitUsd: number; previousLimitUsd: number; approvedBy: string; createdAt: number }[];
  rateLimits: { feature: Feature; label: string; perMinute: number }[];
}

export async function usageSummary(userId: string, tz: string): Promise<UsageSummary> {
  const zone = resolveTimeZone(tz);
  const today = dayKeyInTimeZone(zone);
  const days = Array.from({ length: 30 }, (_, i) => dayKeyInTimeZone(zone, new Date(Date.now() - (29 - i) * 86_400_000)));

  const [spentUsd, limitUsd, perFeature, perDay, raises, estimates] = await Promise.all([
    spentOn(userId, today),
    limitOn(userId, today),
    db
      .select({
        feature: usageEvents.feature,
        spent: sql<number>`sum(${usageEvents.costUsd})`,
        runs: sql<number>`count(distinct ${usageEvents.runId})`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), eq(usageEvents.day, today)))
      .groupBy(usageEvents.feature),
    db
      .select({ day: usageEvents.day, spent: sql<number>`sum(${usageEvents.costUsd})` })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), gte(usageEvents.day, days[0])))
      .groupBy(usageEvents.day),
    db
      .select({
        day: budgetRaises.day,
        limitUsd: budgetRaises.limitUsd,
        previousLimitUsd: budgetRaises.previousLimitUsd,
        approvedBy: budgetRaises.approvedBy,
        createdAt: budgetRaises.createdAt,
      })
      .from(budgetRaises)
      .where(eq(budgetRaises.userId, userId))
      .orderBy(desc(budgetRaises.createdAt))
      .limit(30),
    Promise.all(FEATURES.map((f) => estimateRunCost(userId, f))),
  ]);

  const spentByDay = new Map(perDay.map((r) => [r.day, Number(r.spent)]));
  return {
    timeZone: zone,
    today,
    spentUsd,
    limitUsd,
    defaultLimitUsd: DEFAULT_DAILY_BUDGET_USD,
    maxLimitUsd: MAX_DAILY_BUDGET_USD,
    resetsAt: nextMidnightInTimeZone(zone),
    byFeature: FEATURES.map((feature, i) => {
      const row = perFeature.find((r) => r.feature === feature);
      return {
        feature,
        label: FEATURE_LABELS[feature],
        spentUsd: Number(row?.spent ?? 0),
        runs: Number(row?.runs ?? 0),
        estimateUsd: estimates[i],
      };
    }),
    last30Days: days.map((day) => ({ day, spentUsd: spentByDay.get(day) ?? 0 })),
    raises: raises.map((r) => ({ ...r, limitUsd: Number(r.limitUsd), previousLimitUsd: Number(r.previousLimitUsd) })),
    rateLimits: FEATURES.map((feature) => ({ feature, label: FEATURE_LABELS[feature], perMinute: RATE_LIMITS[feature] })),
  };
}
