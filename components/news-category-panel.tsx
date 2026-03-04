'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NewsPanel } from '@/components/news-panel';
import { useNewsStream } from '@/components/news-display';
import { Search, Clock, AlertCircle, Play } from 'lucide-react';

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

interface NewsCategoryPanelProps {
  icon: string;
  title: string;
  description: string;
  /** Which backend mode this panel uses. 'newsletter' is a UI-only placeholder. */
  mode: 'general' | 'region' | 'curated' | 'research' | 'newsletter';
  /** Rendered inside the panel body for the newsletter placeholder. */
  placeholder?: React.ReactNode;
  /** Called whenever search status or article count changes — used for tab badges. */
  onStatusChange?: (status: string, count: number) => void;
  /** Called when the user clicks "Manage sources" in the curated panel header. */
  onManageSources?: () => void;
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
  const { events, digest, status, errorMsg, run } = useNewsStream();

  const [question, setQuestion] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const [region, setRegion] = useState<Region>('US');

  const searchEvents = events.filter((e) => e.type === 'searching') as { type: 'searching'; query: string }[];
  const modeType = mode === 'curated' ? 'curated' : mode === 'research' ? 'curated' : mode === 'region' ? 'region' : 'general';
  const articleCount = digest?.topics.reduce((s, t) => s + t.article_count, 0) ?? 0;

  useEffect(() => {
    onStatusChange?.(status, articleCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, articleCount]);

  function handleRun() {
    if (mode === 'newsletter') return;
    run({
      question: question.trim() || undefined,
      mode,
      time_range: mode === 'research' ? 'week' : timeRange,
      region: mode === 'region' ? region : undefined,
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

  return (
    <div className="flex flex-col h-full">

      {/* ── Panel header ───────────────────────────────────────────── */}
      <div className="bg-muted/30 border-b px-4 py-3 space-y-1.5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{icon}</span>
            <h2 className="font-semibold text-sm">{title}</h2>
          </div>

          {mode === 'newsletter' && (
            <Badge className="text-xs bg-primary/15 text-primary border border-primary/25">Coming Soon</Badge>
          )}
          {mode !== 'newsletter' && status === 'loading' && (
            <Badge variant="outline" className="text-xs animate-pulse">Searching…</Badge>
          )}
          {mode !== 'newsletter' && status === 'done' && digest && (
            <Badge variant="secondary" className="text-xs">
              {articleCount} article{articleCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {(mode === 'curated' || mode === 'research') && onManageSources && (
            <button
              onClick={onManageSources}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Manage sources
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{description}</p>

        {/* Search-progress badges */}
        {searchEvents.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {searchEvents.map((e, i) => (
              <Badge key={i} variant="outline" className="text-xs gap-1 font-normal py-0 h-5">
                <Search className="h-2.5 w-2.5" />
                {e.query}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ── Per-panel filter UI (not for newsletter) ─────────────── */}
      {mode !== 'newsletter' && (
        <div className="border-b px-4 py-3 space-y-2 flex-shrink-0 bg-background">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun();
            }}
            placeholder={placeholder_text}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
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
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger className="w-[140px] h-7 text-xs">
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} className="text-xs">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              size="sm"
              className="h-7 text-xs gap-1 ml-auto"
              onClick={handleRun}
              disabled={status === 'loading'}
            >
              <Play className="h-3 w-3" />
              {status === 'loading' ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Panel body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">
        {mode === 'newsletter' ? (
          placeholder
        ) : status === 'idle' ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 gap-2">
            <Clock className="h-7 w-7 text-muted-foreground opacity-25" />
            <p className="text-xs text-muted-foreground">Enter a question and click Run ⌘↵</p>
          </div>
        ) : status === 'loading' && !digest ? (
          <div className="flex flex-col items-center justify-center h-full py-10 gap-2">
            <p className="text-xs text-muted-foreground animate-pulse">Fetching articles…</p>
          </div>
        ) : status === 'error' ? (
          <div className="flex items-start gap-2 text-destructive text-xs border border-destructive/30 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        ) : digest && digest.topics.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-10 gap-1">
            <p className="text-xs text-muted-foreground">
              {mode === 'region'
                ? `No articles found for ${region} in the ${timeRange} time range. Try a broader topic or a longer time range.`
                : mode === 'research'
                ? 'No research articles found. Try a broader query or check your Research Sites sources.'
                : 'No articles found for this query and time range.'}
            </p>
          </div>
        ) : digest ? (
          <NewsPanel topics={digest.topics} mode={modeType} />
        ) : null}
      </div>
    </div>
  );
}
