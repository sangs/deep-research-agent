'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ExternalLink } from 'lucide-react';
import { renderExcerpt } from '@/components/news-card';
import type { TopicCluster } from '@/components/topic-group';
import type { ArticleItem } from '@/components/news-card';

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

interface OpenArticle {
  article: ArticleItem;
}

interface NewsletterDigestViewProps {
  topics: TopicCluster[];
}

export function NewsletterDigestView({ topics }: NewsletterDigestViewProps) {
  const [openArticle, setOpenArticle] = useState<OpenArticle | null>(null);

  // Build flat index: each article gets a sequential number across all groups
  let counter = 0;
  const groupsWithNumbers = topics.map((cluster, groupIdx) => ({
    cluster,
    groupIdx,
    articles: cluster.articles.map((article) => ({ article, num: ++counter })),
  }));

  const totalArticles = counter;

  function scrollToSection(groupIdx: number) {
    const el = document.getElementById(`nl-section-${groupIdx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const chip = 'bg-accent/10 text-accent border-accent/20';

  return (
    <div className="space-y-8">
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

            {/* Article rows */}
            {articles.map(({ article, num }) => {
              const date = formatDate(article.published_date);
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
                  {formatDate(openArticle.article.published_date) && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatDate(openArticle.article.published_date)}
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
                      {openArticle.article.links!.map((link, i) => {
                        let hostname = link;
                        try {
                          hostname = new URL(link).hostname.replace(/^www\./, '');
                        } catch {}
                        return (
                          <li key={i}>
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{hostname}</span>
                            </a>
                          </li>
                        );
                      })}
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
