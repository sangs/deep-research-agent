import { resolveTimeRangeStart } from './date-utils';
import type { NewsDigest } from '@/components/news-dashboard';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export async function listResearchSessions(): Promise<SessionMeta[]> {
  try {
    const res = await fetch('/api/history/research', {
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function loadResearchSession(id: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(`/api/history/research/${id}`, {
    });
    if (!res.ok) return null;
    const { messages } = await res.json();
    return messages;
  } catch {
    return null;
  }
}

export async function saveResearchSession(id: string, title: string, messages: unknown[]): Promise<void> {
  try {
    await fetch('/api/history/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, messages }),
    });
  } catch {
    // ignore save errors silently
  }
}

export async function deleteResearchSession(id: string): Promise<void> {
  await fetch(`/api/history/research/${id}`, {
    method: 'DELETE',
  });
}

export async function clearAllResearchSessions(): Promise<void> {
  await fetch('/api/history/research', {
    method: 'DELETE',
  });
}

export async function getCachedDigest(cacheKey: string): Promise<NewsDigest | null> {
  try {
    const res = await fetch(`/api/history/news?key=${encodeURIComponent(cacheKey)}`, {
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.digest ?? null;
  } catch {
    return null;
  }
}

export interface SavedDigestMeta {
  cacheKey: string;
  label: string | null;
  tags: string[];
  locked: boolean;
  articleCount: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  generatedAt: number;
}

export async function saveDigestToCache(
  cacheKey: string,
  digest: NewsDigest,
  ttlSeconds?: number,
  meta?: {
    mode?: string;
    locked?: boolean;
    label?: string;
    tags?: string[];
    articleCount?: number;
    rangeStart?: string;
    rangeEnd?: string;
  }
): Promise<void> {
  try {
    await fetch('/api/history/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheKey, digest, ttlSeconds, ...meta }),
    });
  } catch {
    // ignore save errors silently
  }
}

export async function clearCachedDigest(cacheKey: string): Promise<void> {
  try {
    await fetch(`/api/history/news?key=${encodeURIComponent(cacheKey)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore errors silently
  }
}

/** List saved (locked) digests for a mode, newest first — lightweight metadata only. */
export async function listSavedDigests(mode: string, offset = 0): Promise<{ items: SavedDigestMeta[]; hasMore: boolean }> {
  try {
    const res = await fetch(`/api/history/news/list?mode=${encodeURIComponent(mode)}&offset=${offset}`, {
    });
    if (!res.ok) return { items: [], hasMore: false };
    return res.json();
  } catch {
    return { items: [], hasMore: false };
  }
}

export async function renameDigest(cacheKey: string, label: string | null): Promise<void> {
  try {
    await fetch('/api/history/news', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheKey, label }),
    });
  } catch {
    // ignore errors silently
  }
}

/** Full-replace a digest's tag list (simplest — a handful of tags per digest, no need for granular add/remove endpoints). */
export async function updateDigestTags(cacheKey: string, tags: string[]): Promise<void> {
  try {
    await fetch('/api/history/news', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheKey, tags }),
    });
  } catch {
    // ignore errors silently
  }
}

/** Deterministic cache key from search parameters */
export function buildCacheKey(
  mode: string,
  timeRange: string,
  region: string | undefined,
  question: string
): string {
  return btoa([mode, timeRange, region ?? '', question.trim().toLowerCase()].join('|'));
}

/** Cache key for Newsletter panel — uses resolved start date so the key is
 *  anchored to an actual calendar date, not a relative label.
 *  customStart/customEnd are only used when timeRange === 'custom' — without
 *  them, resolveTimeRangeStart() has no 'custom' case and would silently
 *  fall through to its 'week' default, colliding every custom range with
 *  every other custom range regardless of the actual dates picked. */
export function buildNewsletterCacheKey(
  timeRange: string,
  senders: string,
  subjectKw: string,
  bySource: boolean,
  customStart?: string,
  customEnd?: string
): string {
  const sortedSenders = senders
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  const dateKey = timeRange === 'custom'
    ? `${customStart ?? ''}_${customEnd || customStart || ''}`
    : resolveTimeRangeStart(timeRange); // e.g. "2026-03-30"
  return btoa(['newsletter', dateKey, sortedSenders, subjectKw.trim().toLowerCase(), bySource ? '1' : '0'].join('|'));
}
