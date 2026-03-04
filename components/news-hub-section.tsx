'use client';

import { useState, useCallback } from 'react';
import { Mail, Settings, Lock } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { NewsCategoryPanel } from '@/components/news-category-panel';
import { SourceManager } from '@/components/source-manager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PLANNED_NEWSLETTERS = [
  { name: 'TLDR AI', domain: 'tldr.tech/ai' },
  { name: 'Alpha Signal', domain: 'alphasignal.ai' },
  { name: 'The Deep View', domain: 'thedeepview.co' },
  { name: 'Superhuman AI', domain: 'joinsuperhuman.ai' },
  { name: 'Chartr', domain: 'chartr.co' },
  { name: 'Daily Dose of DS', domain: 'dailydoseofds.com' },
  { name: 'Morning Brew', domain: 'morningbrew.com' },
  { name: 'The Rundown AI', domain: 'therundown.ai' },
];

function NewsletterPlaceholder() {
  return (
    <div className="space-y-4 py-2">
      <div className="border border-dashed rounded-lg p-5 text-center space-y-2">
        <Mail className="h-8 w-8 mx-auto text-muted-foreground opacity-30" />
        <p className="text-sm font-medium">Gmail Integration Coming Soon</p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          Will auto-pull your latest newsletter issues directly from Gmail and summarise them here —
          no manual copy-paste, no missed emails.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Planned sources from your subscriptions
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {PLANNED_NEWSLETTERS.map((n) => (
            <div key={n.domain} className="flex items-center gap-2 p-2 rounded-md bg-muted/40">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{n.name}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{n.domain}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TabStatus = { status: string; count: number };
type TabId = 'global' | 'regional' | 'curated' | 'research' | 'newsletter';

export function NewsHubSection() {
  const [sourceManagerOpen, setSourceManagerOpen] = useState(false);
  const [tabStatus, setTabStatus] = useState<Record<TabId, TabStatus>>({
    global: { status: 'idle', count: 0 },
    regional: { status: 'idle', count: 0 },
    curated: { status: 'idle', count: 0 },
    research: { status: 'idle', count: 0 },
    newsletter: { status: 'idle', count: 0 },
  });

  const handleGlobalStatus = useCallback((status: string, count: number) => {
    setTabStatus((prev) => ({ ...prev, global: { status, count } }));
  }, []);

  const handleRegionalStatus = useCallback((status: string, count: number) => {
    setTabStatus((prev) => ({ ...prev, regional: { status, count } }));
  }, []);

  const handleCuratedStatus = useCallback((status: string, count: number) => {
    setTabStatus((prev) => ({ ...prev, curated: { status, count } }));
  }, []);

  const handleResearchStatus = useCallback((status: string, count: number) => {
    setTabStatus((prev) => ({ ...prev, research: { status, count } }));
  }, []);

  function TabBadge({ tabId }: { tabId: TabId }) {
    const { status, count } = tabStatus[tabId];
    if (status === 'loading') {
      return (
        <span className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      );
    }
    if (status === 'done' && count > 0) {
      return (
        <Badge variant="secondary" className="ml-1.5 text-[10px] px-1 py-0 h-4 min-w-[18px] justify-center">
          {count}
        </Badge>
      );
    }
    return null;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">News Intelligence Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI-aggregated news across global sources, regional feeds, curated blogs, and newsletter
              subscriptions. Each tab runs independently.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1 flex-shrink-0"
            onClick={() => setSourceManagerOpen(true)}
          >
            <Settings className="h-3 w-3" />
            Manage Sources
          </Button>
        </div>

        {/* Tabbed panels */}
        <Tabs defaultValue="global" className="w-full">
          <TabsList className="grid w-full grid-cols-5 h-10">
            <TabsTrigger value="global" className="text-xs flex items-center gap-0">
              🌍 Global<TabBadge tabId="global" />
            </TabsTrigger>
            <TabsTrigger value="regional" className="text-xs flex items-center gap-0">
              🗺️ Regional<TabBadge tabId="regional" />
            </TabsTrigger>
            <TabsTrigger value="curated" className="text-xs flex items-center gap-0">
              📰 Blogs &amp; Sites<TabBadge tabId="curated" />
            </TabsTrigger>
            <TabsTrigger value="research" className="text-xs flex items-center gap-0">
              🔬 Research<TabBadge tabId="research" />
            </TabsTrigger>
            <span
              title="Coming soon — Gmail integration not yet implemented"
              className="cursor-not-allowed flex flex-1"
            >
              <TabsTrigger value="newsletter" disabled className="text-xs w-full pointer-events-none opacity-40 gap-1">
                📬 Newsletter <Lock className="h-2.5 w-2.5" />
              </TabsTrigger>
            </span>
          </TabsList>

          <TabsContent value="global" forceMount className="mt-0 border border-t-0 rounded-b-lg min-h-[580px] flex flex-col data-[state=inactive]:hidden">
            <NewsCategoryPanel
              icon="🌍"
              title="Global News"
              description="Breaking and trending news from worldwide sources"
              mode="general"
              onStatusChange={handleGlobalStatus}
            />
          </TabsContent>

          <TabsContent value="regional" forceMount className="mt-0 border border-t-0 rounded-b-lg min-h-[580px] flex flex-col data-[state=inactive]:hidden">
            <NewsCategoryPanel
              icon="🗺️"
              title="Regional News"
              description="News focused on a specific region — select a region in the filter below"
              mode="region"
              onStatusChange={handleRegionalStatus}
            />
          </TabsContent>

          <TabsContent value="curated" forceMount className="mt-0 border border-t-0 rounded-b-lg min-h-[580px] flex flex-col data-[state=inactive]:hidden">
            <NewsCategoryPanel
              icon="📰"
              title="News Sites & Blogs"
              description="AI/ML coverage from curated tech news sites, research labs, and engineering blogs"
              mode="curated"
              onStatusChange={handleCuratedStatus}
              onManageSources={() => setSourceManagerOpen(true)}
            />
          </TabsContent>

          <TabsContent value="research" forceMount className="mt-0 border border-t-0 rounded-b-lg min-h-[580px] flex flex-col data-[state=inactive]:hidden">
            <NewsCategoryPanel
              icon="🔬"
              title="Research Papers & Lab Posts"
              description="Latest research from AI labs — no time filter, showing most relevant results"
              mode="research"
              onStatusChange={handleResearchStatus}
              onManageSources={() => setSourceManagerOpen(true)}
            />
          </TabsContent>

          <TabsContent value="newsletter" forceMount className="mt-0 border border-t-0 rounded-b-lg min-h-[580px] flex flex-col data-[state=inactive]:hidden">
            <NewsCategoryPanel
              icon="📬"
              title="Newsletter Subscriptions"
              description="Your personal AI/ML newsletter issues sourced from Gmail"
              mode="newsletter"
              placeholder={<NewsletterPlaceholder />}
            />
          </TabsContent>
        </Tabs>
      </div>

      <SourceManager
        open={sourceManagerOpen}
        onClose={() => setSourceManagerOpen(false)}
      />
    </main>
  );
}
