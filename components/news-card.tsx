'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ExternalLink } from 'lucide-react';

export interface ArticleItem {
  title: string;
  url: string;
  source: string;
  published_date: string | null;
  excerpt: string;
  links?: string[];   // newsletter only
}

interface NewsCardProps {
  article: ArticleItem;
  mode?: 'general' | 'curated' | 'region';
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

const modeAccent: Record<string, string> = {
  general: 'border-l-primary',
  curated: 'border-l-accent',
  region:  'border-l-chart-5',
};

const sourceChip: Record<string, string> = {
  general: 'bg-primary/10 text-primary border-primary/20',
  curated: 'bg-accent/10 text-accent border-accent/20',
  region:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

function renderExcerpt(text: string) {
  // Detect structured format: **headline** + bullet lines
  const headlineMatch = text.match(/^\*\*(.+?)\*\*/);
  const bulletLines = text.split('\n').filter(l => l.trim().startsWith('•'));

  if (headlineMatch || bulletLines.length > 0) {
    const headline = headlineMatch ? headlineMatch[1] : null;
    return (
      <div className="space-y-2">
        {headline && (
          <p className="text-xs font-semibold text-foreground leading-snug">{headline}</p>
        )}
        {bulletLines.length > 0 && (
          <ul className="space-y-1">
            {bulletLines.map((line, i) => (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-1.5">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{line.replace(/^•\s*/, '')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>;
}

export function NewsCard({ article, mode = 'general' }: NewsCardProps) {
  const [open, setOpen] = useState(false);
  const date = formatDate(article.published_date);
  const accent = modeAccent[mode] ?? modeAccent.general;
  const chip = sourceChip[mode] ?? sourceChip.general;
  const hasLinks = (article.links?.length ?? 0) > 0;

  return (
    <>
      <Card className={`h-full border-l-2 ${accent} hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 bg-card/80`}>
        <CardHeader className="pb-2 space-y-1.5">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[15px] font-semibold leading-snug hover:text-primary transition-colors line-clamp-2"
          >
            {article.title}
          </a>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={`text-[10px] font-medium border px-1.5 py-0 h-4 ${chip}`}>
              {article.source}
            </Badge>
            {date && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{date}</span>
            )}
          </div>
        </CardHeader>
        <CardContent
          className="pt-0 cursor-pointer hover:bg-muted/40 transition-colors rounded-b-lg"
          onClick={() => setOpen(true)}
        >
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {article.excerpt}
          </p>
        </CardContent>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base leading-snug pr-4">{article.title}</SheetTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className={`text-[10px] font-medium border px-1.5 py-0 h-4 ${chip}`}>
                {article.source}
              </Badge>
              {date && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{date}</span>
              )}
            </div>
          </SheetHeader>

          <div className="space-y-5">
            <div>{renderExcerpt(article.excerpt)}</div>

            {hasLinks && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Links</p>
                <ul className="space-y-1.5">
                  {article.links!.map((link, i) => {
                    let hostname = link;
                    try { hostname = new URL(link).hostname.replace(/^www\./, ''); } catch {}
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
        </SheetContent>
      </Sheet>
    </>
  );
}
