'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NewsCard, type ArticleItem } from '@/components/news-card';

export interface TopicCluster {
  label: string;
  article_count: number;
  articles: ArticleItem[];
}

interface TopicGroupProps {
  cluster: TopicCluster;
  mode?: 'general' | 'curated' | 'region';
  defaultOpen?: boolean;
}

export function TopicGroup({ cluster, mode = 'general', defaultOpen = true }: TopicGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{cluster.label}</span>
          <Badge variant="secondary" className="text-xs">
            {cluster.article_count}
          </Badge>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cluster.articles.map((article, i) => (
              <NewsCard key={`${article.url}-${i}`} article={article} mode={mode} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
