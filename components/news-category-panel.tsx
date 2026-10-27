'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NewsPanel } from '@/components/news-panel';
import { NewsletterDigestView } from '@/components/newsletter-digest-view';
import { SavedDigestsDrawer } from '@/components/saved-digests-drawer';
import { useNewsStream } from '@/components/news-display';
import { useBudgetGate } from '@/components/budget-gate';
import { RunCostHint } from '@/components/run-cost-hint';
import { GmailActivityButton, OrganizeInboxButton } from '@/components/gmail-organize';
import { IngestHealthBanner } from '@/components/ingest-health-banner';
import { Search, Clock, AlertCircle, Play, Square, MessageSquare, Zap, RotateCcw, RefreshCw, ChevronRight, ChevronDown, Mail, ArrowUp, Lock, Bookmark } from 'lucide-react';
import { getCachedDigest, saveDigestToCache, buildCacheKey, buildNewsletterCacheKey } from '@/lib/history-client';
import { toLocalDateKey, resolveTimeRangeStart, formatRelativeTime } from '@/lib/date-utils';

// Newsletter cache rows never expire — Lock adds them, Re-run & replace overwrites them, Saved Digests → Unlock removes them.
// Set to year 2286 (far-future Unix timestamp) so the WHERE expires_at > now() filter always passes.
const NEWSLETTER_NO_EXPIRY = 9999999999;
import type { ThreadEntry } from '@/components/news-display';
import type { NewsDigest } from '@/components/news-dashboard';

type TimeRange = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type Region = 'US' | 'India' | 'Europe' | 'APAC' | 'UK' | 'LatAm';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Past Week' },
  { value: 'month', label: 'Past Month' },
];

// Newsletter-only — 'Custom' isn't wired up for the other 4 tabs' backend yet.
const NEWSLETTER_TIME_RANGES: { value: TimeRange; label: string }[] = [
  ...TIME_RANGES,
  { value: 'custom', label: 'Custom' },
];

// Soft guardrail sized against gmail_service.py's MAX_EMAILS_FETCH/AUTO_BY_SOURCE_THRESHOLD —
// a wider custom range risks a slow, truncated fetch.
const MAX_CUSTOM_RANGE_DAYS = 90;

const REGIONS: { value: Region; label: string }[] = [
  { value: 'US', label: 'United States' },
  { value: 'India', label: 'India' },
  { value: 'Europe', label: 'Europe' },
  { value: 'APAC', label: 'Asia Pacific' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'LatAm', label: 'Latin America' },
];

function articleCount(digest: NewsDigest) {
  return digest.topics.reduce((s, t) => s + t.article_count, 0);
}

/** A prior (non-latest) thread entry — collapsed by default, expandable */
function PriorRun({
  entry,
  index,
  isExpanded,
  onToggle,
  modeType,
}: {
  entry: ThreadEntry;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  modeType: 'general' | 'region' | 'curated';
}) {
  const count = articleCount(entry.digest);
  return (
    <div className="border rounded-lg overflow-hidden bg-muted/10">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground truncate">
            {entry.question || 'Default search'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {entry.fromCache && <Zap className="h-3 w-3 text-primary/70" />}
          <Badge variant="secondary" className="text-xs">{count} article{count !== 1 ? 's' : ''}</Badge>
          {isExpanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pt-2 border-t">
          {entry.digest.topics.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No articles found for this query.</p>
          ) : (
            <NewsPanel topics={entry.digest.topics} mode={modeType} />
          )}
        </div>
      )}
    </div>
  );
}

interface NewsCategoryPanelProps {
  icon: string;
  title: string;
  description: string;
  /** Which backend mode this panel uses. */
  mode: 'general' | 'region' | 'curated' | 'research' | 'newsletter';
  /** Called whenever search status or article count changes — used for tab badges. */
  onStatusChange?: (status: string, count: number) => void;
  /** Called when the user clicks "Manage sources" in the curated panel header. */
  onManageSources?: () => void;
  /** @deprecated no longer used */
  placeholder?: React.ReactNode;
}

export function NewsCategoryPanel({
  icon,
  title,
  description,
  mode,
  placeholder,
  onStatusChange,
  onManageSources,
}: NewsCategoryPanelProps) {
  const { events, digest, thread, status, errorMsg, fromCache, ingest, run, stop, restore, reset } = useNewsStream();
  const { ensureBudget } = useBudgetGate();
  const usageFeature = mode === 'newsletter' ? 'newsletter' : 'news';

  const [question, setQuestion] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const [region, setRegion] = useState<Region>('US');
  // Newsletter-specific state
  const [nlSenders, setNlSenders] = useState('');
  const [nlSubjectKw, setNlSubjectKw] = useState('');
  const [nlBySource, setNlBySource] = useState(false);
  const [nlCustomStart, setNlCustomStart] = useState('');
  const [nlCustomEnd, setNlCustomEnd] = useState('');
  // True after user clicks Lock this session (resets on filter change or new Run)
  const [nlSavedToCache, setNlSavedToCache] = useState(false);
  // Cache key of the saved digest a Re-run & replace is replacing (null otherwise)
  const nlReplaceKeyRef = useRef<string | null>(null);
  const [savedDigestsOpen, setSavedDigestsOpen] = useState(false);
  const [expandedPriorRuns, setExpandedPriorRuns] = useState<Set<number>>(new Set());
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastRunParamsRef = useRef<{ cacheKey: string } | null>(null);
  // The thread's first run (the only cached one), so Refresh can repeat it.
  const firstRunRef = useRef<{
    cacheKey: string;
    request: { question?: string; mode: string; time_range: string; region?: string };
  } | null>(null);
  const [refreshConfirm, setRefreshConfirm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Re-render every minute so "fetched X ago" stays current.
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (status !== 'loading') setRefreshing(false);
  }, [status]);
  const bodyBottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const searchEvents = events.filter((e) => e.type === 'searching') as { type: 'searching'; query: string }[];
  const modeType = mode === 'curated' || mode === 'research' || mode === 'newsletter' ? 'curated' : mode === 'region' ? 'region' : 'general';
  const latestArticleCount = digest ? articleCount(digest) : 0;

  // Newsletter cache key — recomputed whenever filters change (not stored in state)
  const nlCacheKey = mode === 'newsletter'
    ? buildNewsletterCacheKey(timeRange, nlSenders, nlSubjectKw, nlBySource, nlCustomStart, nlCustomEnd)
    : null;
  // Locked = restored from a previously saved cache entry OR locked by the user in this session
  const nlIsLocked = fromCache || nlSavedToCache;

  const todayStr = toLocalDateKey(new Date());
  // A custom range ending today is still "live" (more emails could still arrive today),
  // so it needs the same explicit Lock control as the 'today' preset. A custom range
  // fully in the past behaves like week/month — auto-saved permanently after each run.
  const nlIncludesToday = timeRange === 'today' || (timeRange === 'custom' && (nlCustomEnd || nlCustomStart) === todayStr);

  // Custom range validation — null when valid
  const nlCustomRangeError = (() => {
    if (mode !== 'newsletter' || timeRange !== 'custom') return null;
    if (!nlCustomStart) return 'Pick a start date.';
    if (nlCustomStart > todayStr) return 'Start date cannot be in the future.';
    const effectiveEnd = nlCustomEnd || nlCustomStart;
    if (effectiveEnd > todayStr) return 'End date cannot be in the future.';
    if (effectiveEnd < nlCustomStart) return 'End date must be on or after the start date.';
    const spanDays = (new Date(effectiveEnd).getTime() - new Date(nlCustomStart).getTime()) / 86400000;
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) return `Custom range can't exceed ${MAX_CUSTOM_RANGE_DAYS} days.`;
    return null;
  })();

  // Calendar-date bounds for the current filters — stored alongside locked
  // digests so the Saved Digests picker can show a real date range without
  // deserializing the full digest JSON.
  const nlRangeStart = timeRange === 'custom' ? nlCustomStart : resolveTimeRangeStart(timeRange);
  const nlRangeEnd = timeRange === 'custom'
    ? (nlCustomEnd || nlCustomStart)
    : (timeRange === 'today' || timeRange === 'yesterday') ? nlRangeStart : todayStr;

  // Reset "locked this session" whenever Newsletter filters change
  useEffect(() => {
    if (mode === 'newsletter') setNlSavedToCache(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, nlSenders, nlSubjectKw, nlBySource, nlCustomStart, nlCustomEnd]);

  useEffect(() => {
    onStatusChange?.(status, latestArticleCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, latestArticleCount]);

  // Scroll to bottom when a new thread entry arrives
  useEffect(() => {
    if (status === 'done' && thread.length > 0) {
      bodyBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [thread.length, status]);

  // Clear expanded state when thread is reset
  useEffect(() => {
    if (thread.length === 0) setExpandedPriorRuns(new Set());
  }, [thread.length]);

  function togglePriorRun(index: number) {
    setExpandedPriorRuns((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  async function handleRun() {
    if (mode === 'newsletter') {
      if (nlCustomRangeError) return;
      setNlSavedToCache(false);
      nlReplaceKeyRef.current = null;
      // Check cache — serves locked (today) or auto-cached (historical) results instantly
      const cached = await getCachedDigest(nlCacheKey!);
      if (cached) {
        restore(cached);
        return;
      }
      if (!(await ensureBudget('newsletter'))) return; // cache hits above are free
      run({
        mode: 'newsletter',
        time_range: timeRange,
        newsletter_senders: nlSenders.trim() || undefined,
        newsletter_subject_kw: nlSubjectKw.trim() || undefined,
        newsletter_by_source: nlBySource,
        start_date: timeRange === 'custom' ? nlCustomStart : undefined,
        end_date: timeRange === 'custom' ? (nlCustomEnd || nlCustomStart) : undefined,
      });
      return;
    }

    const effectiveTimeRange = mode === 'research' ? 'week' : timeRange;
    const effectiveRegion = mode === 'region' ? region : undefined;
    const cacheKey = buildCacheKey(mode, effectiveTimeRange, effectiveRegion, question);
    const request = {
      question: question.trim() || undefined,
      mode,
      time_range: effectiveTimeRange,
      region: effectiveRegion,
    };
    setRefreshConfirm(false);

    // Only a thread's first result is cached. A follow-up is answered in the
    // context of the runs above it (conversation_history), so caching it by
    // the question alone would serve it out of context, and vice versa
    // (caching_strategy.md Part 0.3).
    const isFollowUp = thread.length > 0;
    lastRunParamsRef.current = isFollowUp ? null : { cacheKey };
    if (!isFollowUp) {
      firstRunRef.current = { cacheKey, request };
      const cached = await getCachedDigest(cacheKey);
      if (cached) {
        restore(cached, request.question);
        return;
      }
    }
    if (!(await ensureBudget('news'))) return; // cache hits above are free

    run(request);
  }

  // Refresh a cached first result: run it again without the cache. The thread
  // is replaced only when the run succeeds (the save effect then replaces the
  // cached row with a new 1 h expiry); a failed or stopped run keeps it.
  // Follow-ups were built on the old result, so they are cleared, after asking.
  async function handleRefresh() {
    const first = firstRunRef.current;
    if (!first) return;
    if (thread.length > 1 && !refreshConfirm) {
      setRefreshConfirm(true);
      return;
    }
    setRefreshConfirm(false);
    if (!(await ensureBudget('news'))) return;
    lastRunParamsRef.current = { cacheKey: first.cacheKey };
    setRefreshing(true);
    run(first.request, 0, { replaceThread: true });
  }

  const canRefresh =
    mode !== 'newsletter' && thread.length > 0 && thread[0].fromCache && status !== 'loading' && !!firstRunRef.current;
  const followUpCount = Math.max(0, thread.length - 1);

  // Save digest to cache after a fresh (non-cached) run completes (non-newsletter tabs)
  useEffect(() => {
    if (mode !== 'newsletter' && status === 'done' && digest && !fromCache && lastRunParamsRef.current) {
      saveDigestToCache(lastRunParamsRef.current.cacheKey, digest);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, digest, fromCache]);

  // Newsletter historical ranges: auto-save after every fresh run (no-expiry — permanent until removed in Saved Digests).
  // Also saves after a successful Re-run & replace, for any range (today
  // included): that run replaces a digest the user had already locked.
  // Sets nlSavedToCache once the save resolves so nlIsLocked reflects reality —
  // without this the cache-control bar had no way to know a historical range
  // had already been auto-locked, and showed no Lock UI at all for it.
  useEffect(() => {
    if (
      mode === 'newsletter' &&
      status === 'done' &&
      digest &&
      !fromCache &&
      nlCacheKey &&
      (!nlIncludesToday || nlReplaceKeyRef.current === nlCacheKey)
    ) {
      nlReplaceKeyRef.current = null;
      saveDigestToCache(nlCacheKey, digest, NEWSLETTER_NO_EXPIRY, {
        mode: 'newsletter',
        locked: true,
        articleCount: articleCount(digest),
        rangeStart: nlRangeStart,
        rangeEnd: nlRangeEnd,
      }).then(() => setNlSavedToCache(true));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, digest, fromCache]);

  async function handleNlLock() {
    if (!nlCacheKey || !digest) return;
    await saveDigestToCache(nlCacheKey, digest, NEWSLETTER_NO_EXPIRY, {
      mode: 'newsletter',
      locked: true,
      articleCount: articleCount(digest),
      rangeStart: nlRangeStart,
      rangeEnd: nlRangeEnd,
    });
    setNlSavedToCache(true);
  }

  async function handleSelectSavedDigest(cacheKey: string) {
    const cached = await getCachedDigest(cacheKey);
    if (cached) restore(cached);
  }

  // Re-run a saved digest. The saved row is NOT deleted first: it stays until
  // the new run succeeds, then the auto-save effect above replaces it in place
  // (name and tags kept). A failed or cancelled run leaves it untouched.
  async function handleNlRerunAndReplace() {
    if (!nlCacheKey) return;
    if (!(await ensureBudget('newsletter'))) return; // declined: keep the locked digest
    nlReplaceKeyRef.current = nlCacheKey;
    setNlSavedToCache(false);
    reset();
    run({
      mode: 'newsletter',
      time_range: timeRange,
      newsletter_senders: nlSenders.trim() || undefined,
      newsletter_subject_kw: nlSubjectKw.trim() || undefined,
      newsletter_by_source: nlBySource,
      start_date: timeRange === 'custom' ? nlCustomStart : undefined,
      end_date: timeRange === 'custom' ? (nlCustomEnd || nlCustomStart) : undefined,
    });
  }

  const placeholder_text =
    mode === 'curated'
      ? 'AI/ML news topic… (leave blank for curated defaults)'
      : mode === 'research'
      ? 'Research topic… (leave blank for latest AI research)'
      : mode === 'region'
      ? 'Regional news topic… (leave blank for top stories)'
      : 'World news topic… (leave blank for top stories)';

  // Prior runs = all thread entries except the last
  const priorRuns = thread.slice(0, -1);
  // Latest run = last thread entry (always expanded)
  const latestRun = thread.length > 0 ? thread[thread.length - 1] : null;

  return (
    <div className="flex flex-col h-full relative">

      {/* ── Panel header ───────────────────────────────────────────── */}
      <div className="bg-muted/30 border-b px-4 py-3 space-y-1.5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{icon}</span>
            <h2 className="font-semibold text-sm">{title}</h2>
          </div>

          {status === 'loading' && (
            <Badge variant="outline" className="text-xs animate-pulse">Searching…</Badge>
          )}
          {status === 'done' && digest && (
            <div className="flex items-center gap-1.5">
              {mode !== 'newsletter' && (
                <span className="text-xs text-muted-foreground" title={new Date(digest.generated_at).toLocaleString()}>
                  fetched {formatRelativeTime(Date.parse(digest.generated_at) / 1000)}
                </span>
              )}
              {canRefresh && !refreshConfirm && (
                <button
                  onClick={handleRefresh}
                  title="Run the first question again instead of using the saved copy"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              )}
              {fromCache && (
                <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30 bg-primary/5">
                  <Zap className="h-2.5 w-2.5" />
                  Cached
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {latestArticleCount} article{latestArticleCount !== 1 ? 's' : ''}
              </Badge>
            </div>
          )}
          {mode === 'newsletter' && (
            <button
              onClick={() => setSavedDigestsOpen(true)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <Bookmark className="h-3 w-3" />
              Saved digests
            </button>
          )}
          {(mode === 'curated' || mode === 'research' || mode === 'newsletter') && onManageSources && (
            <button
              onClick={onManageSources}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Manage sources
            </button>
          )}
        </div>

        {canRefresh && refreshConfirm && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs rounded-md border border-border bg-background px-2.5 py-1.5">
            <span>
              This clears your {followUpCount} follow-up question{followUpCount !== 1 ? 's' : ''}. Refresh anyway?
            </span>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleRefresh}>Refresh</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setRefreshConfirm(false)}>Cancel</Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{description}</p>
        {mode === 'newsletter' && <IngestHealthBanner />}

        {/* During search — query progress badges (animated, non-clickable) */}
        {status === 'loading' && searchEvents.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {searchEvents.map((e, i) => (
              <Badge key={i} variant="outline" className="text-xs gap-1 font-normal py-0 h-5 animate-pulse">
                <Search className="h-2.5 w-2.5" />
                {e.query}
              </Badge>
            ))}
          </div>
        )}

        {/* After load — clickable topic-label chips for latest run only */}
        {digest && digest.topics.length > 0 && status !== 'loading' && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {[...digest.topics]
              .sort((a, b) => b.article_count - a.article_count)
              .map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const slug = t.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                    document.getElementById(`topic-${slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-normal py-0 h-5 px-2 rounded-full border border-border bg-background hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  <Search className="h-2.5 w-2.5" />
                  {t.label}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* ── Newsletter filter UI ──────────────────────────────────── */}
      {mode === 'newsletter' && (
        <div className="border-b px-4 py-3 space-y-3 flex-shrink-0 bg-background">

          {/* Time range */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Date range</p>
            <ToggleGroup
              type="single"
              value={timeRange}
              onValueChange={(v) => v && setTimeRange(v as TimeRange)}
              className="flex-wrap"
            >
              {NEWSLETTER_TIME_RANGES.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value} className="text-xs h-7 px-2">
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {timeRange === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Start
                  <input
                    type="date"
                    value={nlCustomStart}
                    max={todayStr}
                    disabled={status === 'loading'}
                    onChange={(e) => setNlCustomStart(e.target.value)}
                    className="rounded-md border border-input bg-background/60 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  End
                  <input
                    type="date"
                    value={nlCustomEnd}
                    min={nlCustomStart || undefined}
                    max={todayStr}
                    disabled={status === 'loading'}
                    onChange={(e) => setNlCustomEnd(e.target.value)}
                    placeholder={nlCustomStart}
                    className="rounded-md border border-input bg-background/60 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Leave End blank for a single day
                </span>
              </div>
            )}
            {timeRange === 'custom' && nlCustomRangeError && (
              <p className="text-[10px] text-destructive pt-0.5">{nlCustomRangeError}</p>
            )}
          </div>

          {/* Sender filter */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" />
              From addresses
              <span className="font-normal">(optional — overrides configured senders)</span>
            </p>
            <input
              type="text"
              value={nlSenders}
              onChange={(e) => setNlSenders(e.target.value)}
              placeholder="Leave blank to use configured newsletter senders"
              className="w-full rounded-md border border-input bg-background/60 px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Subject keyword filter */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Subject contains
              <span className="font-normal"> (optional)</span>
            </p>
            <input
              type="text"
              value={nlSubjectKw}
              onChange={(e) => setNlSubjectKw(e.target.value)}
              placeholder="e.g. AI"
              className="w-full rounded-md border border-input bg-background/60 px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Group mode + Run button */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Group by:</span>
              <ToggleGroup
                type="single"
                value={nlBySource ? 'source' : 'topic'}
                onValueChange={(v) => v && setNlBySource(v === 'source')}
              >
                <ToggleGroupItem value="topic" className="text-xs h-7 px-2">Topic</ToggleGroupItem>
                <ToggleGroupItem value="source" className="text-xs h-7 px-2">Source</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              {thread.length > 0 && status !== 'loading' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={reset}
                >
                  <RotateCcw className="h-3 w-3" />
                  New Search
                </Button>
              )}
              <Button
                size="sm"
                disabled={status !== 'loading' && !!nlCustomRangeError}
                className={status === 'loading' ? 'h-7 text-xs gap-1 bg-destructive hover:bg-destructive/90 text-white' : 'h-7 text-xs gap-1'}
                onClick={status === 'loading' ? stop : handleRun}
              >
                {status === 'loading' ? (
                  <><Square className="h-3 w-3" /> Stop</>
                ) : (
                  <><Play className="h-3 w-3" /> Run</>
                )}
              </Button>
            </div>
            <RunCostHint feature={usageFeature} className="mt-1 text-right" />
          </div>
        </div>
      )}

      {/* ── Newsletter cache control bar ─────────────────────────── */}
      {/* Always driven by nlIsLocked, regardless of nlIncludesToday — a historical
          (non-today) Custom/Week/Month range auto-locks itself right after a fresh
          run (see the useEffect above), so it needs the SAME "Digest locked" +
          "Re-run & replace" UI as an explicitly-locked "today" digest, not a
          separate "Re-run fresh only" branch with no Lock feedback at all. Before
          the auto-save effect resolves, this briefly shows "Lock digest" — clicking
          it just performs the same save the effect is already making, a harmless
          no-op duplicate, not a bug. */}
      {mode === 'newsletter' && status === 'done' && latestRun && latestRun.digest.topics.length > 0 && nlCacheKey && (
        <div className="border-b px-4 py-2 flex items-center gap-3 bg-muted/10 flex-shrink-0">
          {nlIsLocked ? (
            <>
              <span className="text-xs text-primary flex items-center gap-1">
                <Lock className="h-3 w-3" /> Digest locked{timeRange === 'today' ? ' for today' : ''}
              </span>
              <button
                onClick={handleNlRerunAndReplace}
                title="Runs this digest again. The saved one is kept until the new run finishes, then replaced (name and tags kept)."
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors ml-auto"
              >
                <RotateCcw className="h-3 w-3" /> Re-run &amp; replace
              </button>
            </>
          ) : (
            <button
              onClick={handleNlLock}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <Lock className="h-3 w-3" /> Lock digest{timeRange === 'today' ? ' for today' : ''}
            </button>
          )}
          {/* Digest-wide Gmail organizing (owner only; hidden otherwise) */}
          <div className="flex items-center gap-1">
            <OrganizeInboxButton topics={latestRun.digest.topics} />
            <GmailActivityButton />
          </div>
        </div>
      )}

      {/* ── Per-panel filter UI (non-newsletter) ─────────────────── */}
      {mode !== 'newsletter' && (
        <div className="border-b px-4 py-3 space-y-2 flex-shrink-0 bg-background">
          <div className="border-l-4 border-primary/70 bg-primary/10 pl-3 pr-1 pt-2 pb-2 rounded-md space-y-1.5">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3 text-primary/70" />
              {thread.length > 0 ? 'Ask a follow-up question' : 'Ask a specific question'}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun();
              }}
              placeholder={thread.length > 0 ? 'Ask a follow-up…' : placeholder_text}
              rows={2}
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'research' ? (
              <p className="text-xs text-muted-foreground italic">
                Research content is not time-filtered — showing most relevant results
              </p>
            ) : (
              <ToggleGroup
                type="single"
                value={timeRange}
                onValueChange={(v) => v && setTimeRange(v as TimeRange)}
                className="flex-wrap"
              >
                {TIME_RANGES.map((t) => (
                  <ToggleGroupItem key={t.value} value={t.value} className="text-xs h-7 px-2">
                    {t.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}

            {mode === 'region' && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Region:</span>
                <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                  <SelectTrigger className="w-[160px] h-9 text-sm font-medium border-primary/50 focus:border-primary bg-primary/5 hover:bg-primary/10 transition-colors">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="text-sm">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              {thread.length > 0 && status !== 'loading' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={reset}
                >
                  <RotateCcw className="h-3 w-3" />
                  New Search
                </Button>
              )}
              <Button
                size="sm"
                className={status === 'loading' ? 'h-7 text-xs gap-1 bg-destructive hover:bg-destructive/90 text-white' : 'h-7 text-xs gap-1'}
                onClick={status === 'loading' ? stop : handleRun}
              >
                {status === 'loading' ? (
                  <><Square className="h-3 w-3" /> Stop</>
                ) : (
                  <><Play className="h-3 w-3" /> Run</>
                )}
              </Button>
            </div>
            <RunCostHint feature={usageFeature} className="mt-1 text-right" />
          </div>
        </div>
      )}

      {/* ── Panel body ─────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4"
        onScroll={(e) => setShowScrollTop((e.currentTarget as HTMLDivElement).scrollTop > 300)}
      >
        {thread.length === 0 && status === 'idle' ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 gap-2">
            <Clock className="h-7 w-7 text-muted-foreground opacity-25" />
            <p className="text-xs text-muted-foreground">
              {mode === 'newsletter'
                ? 'Set filters above and click Run to pull emails from Gmail'
                : 'Enter a question and click Run ⌘↵'}
            </p>
          </div>

        ) : thread.length === 0 && status === 'loading' && ingest ? (
          // Newsletter Phase 2: summarizing handed to the backend's background job
          <div className="flex flex-col items-center justify-center h-full py-10 gap-3 text-center">
            <p className="text-xs text-foreground">
              {ingest.status === 'queued'
                ? `Starting background summarizing of ${ingest.total} new emails…`
                : ingest.status === 'done'
                ? 'Summaries ready. Building the digest…'
                : `Summarizing new emails in the background: ${ingest.done} of ${ingest.total}`}
            </p>
            {ingest.total > 0 && (
              <div className="w-56 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((100 * ingest.done) / ingest.total)}%` }}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground max-w-sm">
              The digest opens here when it&apos;s done. You can leave this page: summaries are saved as they finish,
              and clicking Run again later picks up where it left off.
            </p>
          </div>

        ) : thread.length === 0 && status === 'loading' ? (
          <div className="flex flex-col items-center justify-center h-full py-10 gap-2">
            <p className="text-xs text-muted-foreground animate-pulse">Fetching articles…</p>
          </div>

        ) : thread.length === 0 && status === 'error' ? (
          <div className="flex items-start gap-2 text-destructive text-xs border border-destructive/30 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>

        ) : (
          // ── Conversation thread ───────────────────────────────────
          <div className="space-y-4">

            {/* Prior runs — collapsed by default, expandable */}
            {priorRuns.map((entry, i) => (
              <PriorRun
                key={i}
                entry={entry}
                index={i}
                isExpanded={expandedPriorRuns.has(i)}
                onToggle={() => togglePriorRun(i)}
                modeType={modeType}
              />
            ))}

            {/* Latest completed run — always expanded */}
            {latestRun && (
              <div>
                {/* Label only shown when there are prior runs above */}
                {priorRuns.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-border" />
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">
                        {latestRun.question || 'Default search'}
                      </span>
                      {latestRun.fromCache && (
                        <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30 bg-primary/5 py-0 h-4">
                          <Zap className="h-2.5 w-2.5" />
                          Cached
                        </Badge>
                      )}
                    </div>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}

                {latestRun.digest.topics.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-1">
                    <p className="text-xs text-muted-foreground">
                      {mode === 'region'
                        ? `No articles found for ${region} in the ${timeRange} time range. Try a broader topic or a longer time range.`
                        : mode === 'research'
                        ? 'No research articles found. Try a broader query or check your Research Sites sources.'
                        : mode === 'newsletter'
                        ? 'No emails found. Try a wider date range or remove the sender/subject filter.'
                        : 'No articles found for this query and time range.'}
                    </p>
                  </div>
                ) : mode === 'newsletter' ? (
                  <NewsletterDigestView
                    topics={latestRun.digest.topics}
                    notices={latestRun.digest.notices}
                  />
                ) : (
                  <NewsPanel topics={latestRun.digest.topics} mode={modeType} />
                )}
              </div>
            )}

            {/* Loading indicator for follow-up runs (thread already has prior results) */}
            {status === 'loading' && thread.length > 0 && (
              <div className="flex flex-col items-center py-6 gap-1.5 border border-dashed rounded-lg">
                <p className="text-xs text-muted-foreground animate-pulse">
                  {refreshing ? 'Refreshing… the results above stay until the new ones arrive.' : 'Fetching follow-up results…'}
                </p>
              </div>
            )}

            {/* Error during a follow-up run (prior results still visible above) */}
            {status === 'error' && thread.length > 0 && (
              <div className="flex items-start gap-2 text-destructive text-xs border border-destructive/30 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div ref={bodyBottomRef} />
          </div>
        )}
      </div>

      {/* Floating scroll-to-top button — appears after scrolling 300px */}
      {showScrollTop && (
        <button
          onClick={() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="absolute bottom-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-muted border border-border shadow-md hover:bg-muted/80 transition-colors"
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {mode === 'newsletter' && (
        <SavedDigestsDrawer
          open={savedDigestsOpen}
          mode="newsletter"
          onClose={() => setSavedDigestsOpen(false)}
          onSelect={handleSelectSavedDigest}
        />
      )}
    </div>
  );
}
