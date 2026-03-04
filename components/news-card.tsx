import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface ArticleItem {
  title: string;
  url: string;
  source: string;
  published_date: string | null;
  excerpt: string;
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

const modeTints: Record<string, string> = {
  general: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  curated: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  region: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

export function NewsCard({ article, mode = 'general' }: NewsCardProps) {
  const date = formatDate(article.published_date);
  const tint = modeTints[mode] ?? modeTints.general;

  return (
    <Card className="h-full hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 space-y-1">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium leading-snug hover:underline text-blue-600 dark:text-blue-400 line-clamp-2"
        >
          {article.title}
        </a>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs font-normal border-0 ${tint}`}>
            {article.source}
          </Badge>
          {date && (
            <Badge variant="outline" className="text-xs font-normal">
              {date}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {article.excerpt}
        </p>
      </CardContent>
    </Card>
  );
}
