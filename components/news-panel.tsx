'use client';

import { useState } from 'react';
import { TopicGroup, type TopicCluster } from '@/components/topic-group';
import { NewsTocSidebar } from '@/components/news-toc-sidebar';

interface NewsPanelProps {
  topics: TopicCluster[];
  mode: 'general' | 'curated' | 'region';
}

function toSlug(label: string) {
  return label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function NewsPanel({ topics, mode }: NewsPanelProps) {
  const sorted = [...topics].sort((a, b) => b.article_count - a.article_count);

  // Initial state: first group open, rest closed.
  // NewsPanel is remounted (via key in NewsDashboard) when a new digest arrives,
  // so this initializer always reflects the latest topics without needing an effect.
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>(
    () => Object.fromEntries(sorted.map((_, i) => [i, i === 0]))
  );

  if (topics.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No topics found for this time range.
      </div>
    );
  }

  function toggle(i: number) {
    setOpenGroups(prev => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <div className="flex gap-6 items-start">
      {/* Main feed */}
      <div className="flex-1 min-w-0 space-y-4">
        {sorted.map((cluster, i) => (
          <TopicGroup
            key={`${cluster.label}-${i}`}
            cluster={cluster}
            mode={mode}
            id={`topic-${toSlug(cluster.label)}`}
            groupIndex={i}
            open={openGroups[i] ?? false}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>

      {/* TOC sidebar — hidden below lg breakpoint */}
      <NewsTocSidebar topics={sorted} openGroups={openGroups} />
    </div>
  );
}
