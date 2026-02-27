import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SourceResult {
  title: string;
  url: string;
  text: string;
  publishedDate: string | null;
  score: number | null;
}

interface SourceCardProps {
  result: SourceResult;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export function SourceCard({ result }: SourceCardProps) {
  const domain = getDomain(result.url);
  const date = formatDate(result.publishedDate);
  const excerpt = result.text.slice(0, 200).trim() + (result.text.length > 200 ? '…' : '');

  return (
    <Card className="h-full hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 space-y-1">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium leading-snug hover:underline text-blue-600 dark:text-blue-400 line-clamp-2"
        >
          {result.title}
        </a>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs font-normal">
            {domain}
          </Badge>
          {date && (
            <Badge variant="outline" className="text-xs font-normal">
              {date}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground leading-relaxed">{excerpt}</p>
      </CardContent>
    </Card>
  );
}
