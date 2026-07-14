'use client';

import type { TopicCluster } from '@/components/topic-group';

interface NewsTocSidebarProps {
  topics: TopicCluster[];
  openGroups: Record<number, boolean>;
}

export function NewsTocSidebar({ topics, openGroups }: NewsTocSidebarProps) {
  const hasVisible = topics.some((_, i) => openGroups[i]);
  if (!hasVisible) return null;

  function scrollToCard(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const visibleIndices = topics.map((_, i) => i).filter(i => openGroups[i]);

  return (
    <aside className="hidden lg:block w-56 flex-shrink-0 sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <div className="py-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 px-1 mb-3">
          On This Page
        </p>

        <div className="space-y-3">
          {visibleIndices.map((groupIndex, pos) => {
            const cluster = topics[groupIndex];
            return (
              <div key={groupIndex} className={pos > 0 ? 'pt-3 border-t border-border/50' : ''}>
                {/* Group heading */}
                <p className="text-[11px] font-semibold text-primary truncate px-1 pb-1.5">
                  {cluster.label}
                </p>

                {/* Article list — left border ties items to the group */}
                <ul className="border-l-2 border-primary/25 ml-1 pl-2 space-y-0.5">
                  {cluster.articles.map((article, articleIndex) => (
                    <li key={articleIndex}>
                      <button
                        onClick={() => scrollToCard(`card-${groupIndex}-${articleIndex}`)}
                        className="w-full text-left text-[11px] text-foreground/75 hover:text-foreground transition-colors py-0.5 rounded hover:bg-muted/60 leading-snug line-clamp-2 flex gap-1"
                      >
                        <span className="text-primary/50 shrink-0 mt-px">›</span>
                        <span>{article.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
