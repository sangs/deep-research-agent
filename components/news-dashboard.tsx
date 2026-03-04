import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewsPanel } from '@/components/news-panel';
import type { TopicCluster } from '@/components/topic-group';

export interface NewsDigest {
  mode: string;
  time_range: string;
  region: string | null;
  generated_at: string;
  topics: TopicCluster[];
}

interface NewsDashboardProps {
  digest: NewsDigest;
}

function getTabLabel(digest: NewsDigest): string {
  if (digest.mode === 'region' && digest.region) return `Region: ${digest.region}`;
  if (digest.mode === 'curated') return 'Curated Sources';
  return 'Global News';
}

function getModeType(mode: string): 'general' | 'curated' | 'region' {
  if (mode === 'curated') return 'curated';
  if (mode === 'region') return 'region';
  return 'general';
}

function formatTimestamp(iso: string): string {
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

export function NewsDashboard({ digest }: NewsDashboardProps) {
  const tabLabel = getTabLabel(digest);
  const modeType = getModeType(digest.mode);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {digest.topics.reduce((sum, t) => sum + t.article_count, 0)} articles across{' '}
          {digest.topics.length} topics · Generated {formatTimestamp(digest.generated_at)}
        </p>
      </div>

      <Tabs defaultValue="main">
        <TabsList>
          <TabsTrigger value="main">{tabLabel}</TabsTrigger>
        </TabsList>
        <TabsContent value="main" className="mt-4">
          <NewsPanel topics={digest.topics} mode={modeType} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
