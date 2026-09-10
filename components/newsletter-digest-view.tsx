'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ExternalLink, ChevronDown, AlertTriangle } from 'lucide-react';
import { renderExcerpt } from '@/components/news-card';
import { formatBareDate } from '@/lib/date-utils';
import { labelLinks } from '@/lib/link-utils';
import type { TopicCluster } from '@/components/topic-group';
import type { ArticleItem } from '@/components/news-card';

interface OpenArticle {
  article: ArticleItem;
}

interface NewsletterDigestViewProps {
  topics: TopicCluster[];
  /** True when the backend fetch hit its email cap and more matched than were fetched. */
  truncated?: boolean;
  /** Total emails matched by Gmail, when known (may exceed the number rendered). */
  totalCount?: number;
}

// Articles shown per topic group before a "Show more" expander appears —
// bounds initial DOM size regardless of how large the digest is.
const VISIBLE_STEP = 10;

export function NewsletterDigestView({ topics, truncated, totalCount }: NewsletterDigestViewProps) {
  const [openArticle, setOpenArticle] = useState<OpenArticle | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<number, number>>({});

  // Build flat index: each article gets a sequential number across all groups
  let counter = 0;
  const groupsWithNumbers = topics.map((cluster, groupIdx) => ({
    cluster,
    groupIdx,
    articles: cluster.articles.map((article) => ({ article, num: ++counter })),
  }));

  const totalArticles = counter;

  function showMore(groupIdx: number) {
    setVisibleCounts((prev) => ({ ...prev, [groupIdx]: (prev[groupIdx] ?? VISIBLE_STEP) + VISIBLE_STEP }));
  }

  function scrollToSection(groupIdx: number) {
    const el = document.getElementById(`nl-section-${groupIdx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const chip = 'bg-accent/10 text-accent border-accent/20';

  return (
    <div className="space-y-8">
      {/* Truncation notice — Gmail matched more emails than were fetched */}
      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Showing {totalArticles} of {totalCount} matching emails. Narrow the date range or sender
            filter to see the rest.
          </span>
        </div>
      )}

      {/* AT A GLANCE */}
      <div className="rounded-xl border border-border/60 bg-muted/30 px-5 py-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          At a Glance
        </p>
        <ul className="space-y-1.5">
          {topics.map((cluster, i) => (
            <li key={i}>
              <button
                onClick={() => scrollToSection(i)}
                className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground transition-colors group text-left"
              >
                <span className="text-muted-foreground/50 group-hover:text-primary transition-colors">·</span>
                <span className="group-hover:text-primary transition-colors">{cluster.label}</span>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 border-border/60 text-muted-foreground"
                >
                  {cluster.articles.length}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-foreground/60 pt-1">
          {totalArticles} articles across {topics.length} topics
        </p>
      </div>

      {/* MY NEWSLETTERS */}
      <div className="space-y-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          My Newsletters
        </p>

        {groupsWithNumbers.map(({ cluster, groupIdx, articles }) => (
          <div key={groupIdx} id={`nl-section-${groupIdx}`} className="space-y-1">
            {/* Section heading */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wide">
                {cluster.label}
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            {/* Article rows — paginated so a huge digest doesn't dump its entire
                article list into the DOM at once */}
            {articles.slice(0, visibleCounts[groupIdx] ?? VISIBLE_STEP).map(({ article, num }) => {
              const date = formatBareDate(article.published_date);
              return (
                <div
                  key={num}
                  className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors group"
                  onClick={() => setOpenArticle({ article })}
                >
                  {/* Number */}
                  <span className="text-[11px] font-bold text-primary/70 tabular-nums w-5 shrink-0 mt-0.5">
                    {String(num).padStart(2, '0')}
                  </span>

                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    {article.url ? (
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium leading-snug hover:text-primary transition-colors line-clamp-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {article.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium leading-snug line-clamp-2">
                        {article.title}
                      </span>
                    )}
                  </div>

                  {/* Source + date */}
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <Badge className={`text-[10px] font-medium border px-1.5 py-0 h-4 ${chip}`}>
                      {article.source}
                    </Badge>
                    {date && (
                      <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:block">
                        {date}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Show more — reveals the next VISIBLE_STEP articles in this group */}
            {articles.length > (visibleCounts[groupIdx] ?? VISIBLE_STEP) && (
              <button
                onClick={() => showMore(groupIdx)}
                className="flex items-center gap-1 pl-2 pt-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <ChevronDown className="h-3 w-3" />
                Show {Math.min(VISIBLE_STEP, articles.length - (visibleCounts[groupIdx] ?? VISIBLE_STEP))} more
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Sheet drawer */}
      <Sheet open={openArticle !== null} onOpenChange={(open) => !open && setOpenArticle(null)}>
        <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
          {openArticle && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base leading-snug pr-4">
                  {openArticle.article.title}
                </SheetTitle>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className={`text-[10px] font-medium border px-1.5 py-0 h-4 ${chip}`}>
                    {openArticle.article.source}
                  </Badge>
                  {formatBareDate(openArticle.article.published_date) && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatBareDate(openArticle.article.published_date)}
                    </span>
                  )}
                </div>
              </SheetHeader>

              <div className="space-y-5">
                <div>{renderExcerpt(openArticle.article.excerpt)}</div>

                {(openArticle.article.links?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Links
                    </p>
                    <ul className="space-y-1.5">
                      {labelLinks(openArticle.article.links!).map(({ url, label }, i) => (
                        <li key={i}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{label}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
