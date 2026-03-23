'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NewsPanel } from '@/components/news-panel';
import { useNewsStream } from '@/components/news-display';
import { Search, Clock, AlertCircle, Play, Square, MessageSquare, Zap, RotateCcw, ChevronRight, ChevronDown, Mail, ArrowUp, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { getCachedDigest, saveDigestToCache, clearCachedDigest, buildCacheKey, buildNewsletterCacheKey } from '@/lib/history-client';

// Newsletter cache rows never expire — Lock/Unlock is the only way to add/remove them.
// Set to year 2286 (far-future Unix timestamp) so the WHERE expires_at > now() filter always passes.
const NEWSLETTER_NO_EXPIRY = 9999999999;
import type { ThreadEntry } from '@/components/news-display';
import type { NewsDigest } from '@/components/news-dashboard';

type TimeRange = 'today' | 'yesterday' | 'week' | 'month';
type Region = 'US' | 'India' | 'Europe' | 'APAC' | 'UK' | 'LatAm';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Past Week' },
  { value: 'month', label: 'Past Month' },
];

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
  const { events, digest, thread, status, errorMsg, fromCache, run, stop, restore, reset } = useNewsStream();

  const [question, setQuestion] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const [region, setRegion] = useState<Region>('US');
  // Newsletter-specific state
  const [nlSenders, setNlSenders] = useState('');
  const [nlSubjectKw, setNlSubjectKw] = useState('');
  const [nlBySource, setNlBySource] = useState(false);
  // True after user clicks Lock this session (resets on filter change or new Run)
  const [nlSavedToCache, setNlSavedToCache] = useState(false);
  const [expandedPriorRuns, setExpandedPriorRuns] = useState<Set<number>>(new Set());
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastRunParamsRef = useRef<{ cacheKey: string } | null>(null);
  const bodyBottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const searchEvents = events.filter((e) => e.type === 'searching') as { type: 'searching'; query: string }[];
  const modeType = mode === 'curated' || mode === 'research' || mode === 'newsletter' ? 'curated' : mode === 'region' ? 'region' : 'general';
  const latestArticleCount = digest ? articleCount(digest) : 0;

  // Newsletter cache key — recomputed whenever filters change (not stored in state)
  const nlCacheKey = mode === 'newsletter'
    ? buildNewsletterCacheKey(timeRange, nlSenders, nlSubjectKw, nlBySource)
    : null;
  // Locked = restored from a previously saved cache entry OR locked by the user in this session
  const nlIsLocked = fromCache || nlSavedToCache;

  // Reset "locked this session" whenever Newsletter filters change
  useEffect(() => {
    if (mode === 'newsletter') setNlSavedToCache(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, nlSenders, nlSubjectKw, nlBySource]);

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
      setNlSavedToCache(false);
      // Check cache — serves locked (today) or auto-cached (historical) results instantly
      const cached = await getCachedDigest(nlCacheKey!);
      if (cached) {
        restore(cached);
        return;
      }
      run({
        mode: 'newsletter',
        time_range: timeRange,
        newsletter_senders: nlSenders.trim() || undefined,
        newsletter_subject_kw: nlSubjectKw.trim() || undefined,
        newsletter_by_source: nlBySource,
      });
      return;
    }

    const effectiveTimeRange = mode === 'research' ? 'week' : timeRange;
    const effectiveRegion = mode === 'region' ? region : undefined;
    const cacheKey = buildCacheKey(mode, effectiveTimeRange, effectiveRegion, question);
    lastRunParamsRef.current = { cacheKey };

    // Check cache before hitting the backend
    const cached = await getCachedDigest(cacheKey);
    if (cached) {
      restore(cached, question.trim() || undefined);
      return;
    }

    run({
      question: question.trim() || undefined,
      mode,
      time_range: effectiveTimeRange,
      region: effectiveRegion,
    });
  }

  // Save digest to cache after a fresh (non-cached) run completes (non-newsletter tabs)
  useEffect(() => {
    if (mode !== 'newsletter' && status === 'done' && digest && !fromCache && lastRunParamsRef.current) {
      saveDigestToCache(lastRunParamsRef.current.cacheKey, digest);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, digest, fromCache]);

  // Newsletter historical ranges: auto-save after every fresh run (no-expiry — permanent until Re-run fresh)
  useEffect(() => {
    if (
      mode === 'newsletter' &&
      status === 'done' &&
      digest &&
      !fromCache &&
      timeRange !== 'today' &&
      nlCacheKey
    ) {
      saveDigestToCache(nlCacheKey, digest, NEWSLETTER_NO_EXPIRY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, digest, fromCache]);

  async function handleNlLock() {
    if (!nlCacheKey || !digest) return;
    await saveDigestToCache(nlCacheKey, digest, NEWSLETTER_NO_EXPIRY);
    setNlSavedToCache(true);
  }

  async function handleNlUnlockAndRefresh() {
    if (!nlCacheKey) return;
    await clearCachedDigest(nlCacheKey);
    setNlSavedToCache(false);
    reset();
    run({
      mode: 'newsletter',
      time_range: timeRange,
      newsletter_senders: nlSenders.trim() || undefined,
      newsletter_subject_kw: nlSubjectKw.trim() || undefined,
      newsletter_by_source: nlBySource,
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
          {(mode === 'curated' || mode === 'research' || mode === 'newsletter') && onManageSources && (
            <button
              onClick={onManageSources}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Manage sources
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{description}</p>

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
              {TIME_RANGES.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value} className="text-xs h-7 px-2">
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
          </div>
        </div>
      )}

      {/* ── Newsletter cache control bar ─────────────────────────── */}
      {mode === 'newsletter' && status === 'done' && latestRun && latestRun.digest.topics.length > 0 && nlCacheKey && (
        <div className="border-b px-4 py-2 flex items-center gap-3 bg-muted/10 flex-shrink-0">
          {timeRange === 'today' ? (
            nlIsLocked ? (
              <>
                <span className="text-xs text-primary flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Digest locked for today
                </span>
                <button
                  onClick={handleNlUnlockAndRefresh}
                  className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors ml-auto"
                >
                  <LockOpen className="h-3 w-3" /> Unlock &amp; re-run
                </button>
              </>
            ) : (
              <button
                onClick={handleNlLock}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                <Lock className="h-3 w-3" /> Lock digest for today
              </button>
            )
          ) : (
            <button
              onClick={handleNlUnlockAndRefresh}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors ml-auto"
            >
              <RefreshCw className="h-3 w-3" /> Re-run fresh
            </button>
          )}
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
                ) : (
                  <NewsPanel topics={latestRun.digest.topics} mode={modeType} />
                )}
              </div>
            )}

            {/* Loading indicator for follow-up runs (thread already has prior results) */}
            {status === 'loading' && thread.length > 0 && (
              <div className="flex flex-col items-center py-6 gap-1.5 border border-dashed rounded-lg">
                <p className="text-xs text-muted-foreground animate-pulse">Fetching follow-up results…</p>
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
    </div>
  );
}
