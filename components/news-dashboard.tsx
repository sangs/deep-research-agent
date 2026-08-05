import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewsPanel } from '@/components/news-panel';
import { formatIsoDateTime } from '@/lib/date-utils';
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

export function NewsDashboard({ digest }: NewsDashboardProps) {
  const tabLabel = getTabLabel(digest);
  const modeType = getModeType(digest.mode);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {digest.topics.reduce((sum, t) => sum + t.article_count, 0)} articles across{' '}
          {digest.topics.length} topics · Generated {formatIsoDateTime(digest.generated_at)}
        </p>
      </div>

      <Tabs defaultValue="main">
        <TabsList>
          <TabsTrigger value="main">{tabLabel}</TabsTrigger>
        </TabsList>
        <TabsContent value="main" className="mt-4">
          <NewsPanel key={digest.generated_at} topics={digest.topics} mode={modeType} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
