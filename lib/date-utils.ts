/**
 * Centralized date/time formatting and resolution helpers.
 * Consolidates logic that was previously duplicated across news-card.tsx,
 * newsletter-digest-view.tsx, source-card.tsx, news-dashboard.tsx,
 * history-drawer.tsx, lib/history-client.ts, and news-display.tsx.
 */

/**
 * Bare "YYYY-MM-DD" → short date, e.g. "Aug 5". Used for newsletter/news
 * article cards where the API only supplies a date, no time-of-day.
 * Appending T00:00:00 (no tz) makes JS parse it as LOCAL midnight instead of
 * UTC midnight, avoiding an off-by-one-day shift for readers west of UTC.
 */
export function formatBareDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/**
 * Full ISO-8601 datetime → short date WITH year, e.g. "Aug 5, 2026".
 * Used for source cards, where Exa supplies a full ISO datetime (has an
 * explicit offset/instant, so no UTC-midnight ambiguity applies).
 */
export function formatIsoDateWithYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/**
 * Format an article's published_date regardless of which shape it arrives in
 * — full ISO-8601 datetime (Exa-backed tabs: General/Regional/Curated/Research)
 * or bare "YYYY-MM-DD" (Newsletter, via backend's format_header_date()).
 * NewsCard renders articles from either source (a prior Newsletter run can be
 * displayed through the generic NewsPanel/NewsCard path), so it needs a
 * formatter that detects which shape it received instead of assuming one —
 * blindly using formatIsoDateWithYear on a bare date would reintroduce the
 * UTC-midnight off-by-one-day bug fixed 2026-08-05; blindly using
 * formatBareDate on a full timestamp produces "Invalid Date" (a malformed
 * double-timestamp string once T00:00:00 is appended).
 */
export function formatArticleDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  return dateStr.includes('T') ? formatIsoDateWithYear(dateStr) : formatBareDate(dateStr);
}

/**
 * Full ISO-8601 datetime → short date + time, e.g. "Aug 5, 2:15 PM".
 * Used for the digest "Generated ..." timestamp.
 */
export function formatIsoDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Unix-seconds timestamp → relative label ("just now"/"5m ago"/"3h ago"/
 * "2d ago"), falling back to a plain locale date for >=7 days old.
 */
export function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

/**
 * A Date's own local calendar day as "YYYY-MM-DD", extracted directly from
 * its Y/M/D field accessors — never round-trip through .toISOString(), which
 * always converts to UTC and silently shifts the date for any timezone ahead
 * of UTC (e.g. India, Japan, most of Europe/Asia).
 */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve a timeRange label to its actual start date (YYYY-MM-DD).
 * Mirrors backend/tools/date_utils.py resolve_date_range() so cache keys are
 * anchored to real calendar dates, not relative label strings.
 *
 * Without this, "yesterday" on 2026-03-31 and "yesterday" on 2026-03-30
 * would produce the same cache key despite covering different date ranges.
 */
export function resolveTimeRangeStart(timeRange: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight local
  let start: Date;
  switch (timeRange) {
    case 'today':
      start = today;
      break;
    case 'yesterday':
      start = new Date(today);
      start.setDate(today.getDate() - 1);
      break;
    case 'week':
      start = new Date(today);
      start.setDate(today.getDate() - 7);
      break;
    case 'month':
      start = new Date(today);
      start.setDate(today.getDate() - 30);
      break;
    default:
      start = new Date(today);
      start.setDate(today.getDate() - 7);
  }
  return toLocalDateKey(start);
}

/**
 * Browser's IANA timezone (e.g. 'America/Los_Angeles'), sent with News Hub
 * requests so the backend can resolve 'today'/'yesterday' day boundaries to
 * the user's local calendar day instead of UTC — see
 * backend/tools/date_utils.py resolve_date_range().
 */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
