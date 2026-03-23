import { getUserId } from './user-id';
import type { NewsDigest } from '@/components/news-dashboard';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export async function listResearchSessions(): Promise<SessionMeta[]> {
  const userId = getUserId();
  if (!userId) return [];
  try {
    const res = await fetch('/api/history/research', {
      headers: { 'X-User-Id': userId },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function loadResearchSession(id: string): Promise<unknown[] | null> {
  const userId = getUserId();
  if (!userId) return null;
  try {
    const res = await fetch(`/api/history/research/${id}`, {
      headers: { 'X-User-Id': userId },
    });
    if (!res.ok) return null;
    const { messages } = await res.json();
    return messages;
  } catch {
    return null;
  }
}

export async function saveResearchSession(id: string, title: string, messages: unknown[]): Promise<void> {
  const userId = getUserId();
  if (!userId) return;
  try {
    await fetch('/api/history/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ id, title, messages }),
    });
  } catch {
    // ignore save errors silently
  }
}

export async function deleteResearchSession(id: string): Promise<void> {
  const userId = getUserId();
  if (!userId) return;
  await fetch(`/api/history/research/${id}`, {
    method: 'DELETE',
    headers: { 'X-User-Id': userId },
  });
}

export async function clearAllResearchSessions(): Promise<void> {
  const userId = getUserId();
  if (!userId) return;
  await fetch('/api/history/research', {
    method: 'DELETE',
    headers: { 'X-User-Id': userId },
  });
}

export async function getCachedDigest(cacheKey: string): Promise<NewsDigest | null> {
  const userId = getUserId();
  if (!userId) return null;
  try {
    const res = await fetch(`/api/history/news?key=${encodeURIComponent(cacheKey)}`, {
      headers: { 'X-User-Id': userId },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.digest ?? null;
  } catch {
    return null;
  }
}

export async function saveDigestToCache(cacheKey: string, digest: NewsDigest, ttlSeconds?: number): Promise<void> {
  const userId = getUserId();
  if (!userId) return;
  try {
    await fetch('/api/history/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ cacheKey, digest, ttlSeconds }),
    });
  } catch {
    // ignore save errors silently
  }
}

export async function clearCachedDigest(cacheKey: string): Promise<void> {
  const userId = getUserId();
  if (!userId) return;
  try {
    await fetch(`/api/history/news?key=${encodeURIComponent(cacheKey)}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': userId },
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

/** Cache key for Newsletter panel — senders sorted for determinism */
export function buildNewsletterCacheKey(
  timeRange: string,
  senders: string,
  subjectKw: string,
  bySource: boolean
): string {
  const sortedSenders = senders
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  return btoa(['newsletter', timeRange, sortedSenders, subjectKw.trim().toLowerCase(), bySource ? '1' : '0'].join('|'));
}
