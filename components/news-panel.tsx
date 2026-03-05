import { TopicGroup, type TopicCluster } from '@/components/topic-group';

interface NewsPanelProps {
  topics: TopicCluster[];
  mode: 'general' | 'curated' | 'region';
}

function toSlug(label: string) {
  return label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function NewsPanel({ topics, mode }: NewsPanelProps) {
  if (topics.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No topics found for this time range.
      </div>
    );
  }

  const sorted = [...topics].sort((a, b) => b.article_count - a.article_count);

  return (
    <div className="space-y-4">
      {sorted.map((cluster, i) => (
        <TopicGroup
          key={`${cluster.label}-${i}`}
          cluster={cluster}
          mode={mode}
          id={`topic-${toSlug(cluster.label)}`}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}
