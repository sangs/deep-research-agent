import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cleanExcerpt, stripLeadingTitle } from '@/lib/excerpt-utils';

// Toggle to switch excerpt strategy:
//   'highlights' — Exa's query-aware sentence extraction (best quality, query-relevant)
//   'clean_text' — regex-stripped raw page text (deterministic fallback)
const EXCERPT_MODE: 'highlights' | 'clean_text' = 'highlights';

interface SourceResult {
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate: string | null;
  score: number | null;
}

interface SourceCardProps {
  result: SourceResult;
}

type ContentType = { emoji: string; label: string };

function getContentType(url: string): ContentType | null {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace('www.', '');
    if (host === 'youtube.com' || host === 'youtu.be') return { emoji: '🎥', label: 'Video' };
    if (host === 'vimeo.com') return { emoji: '🎥', label: 'Video' };
    if (pathname.toLowerCase().endsWith('.pdf')) return { emoji: '📄', label: 'PDF' };
    if (host === 'github.com') return { emoji: '💻', label: 'GitHub' };
    if (host === 'twitter.com' || host === 'x.com') return { emoji: '🐦', label: 'Post' };
  } catch {
    // ignore
  }
  return null;
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
  const contentType = getContentType(result.url);
  const rawExcerpt =
    EXCERPT_MODE === 'highlights'
      ? cleanExcerpt(result.highlights?.[0] ?? result.text)
      : cleanExcerpt(result.text);
  const excerpt = stripLeadingTitle(rawExcerpt, result.title);

  return (
    <Card className="h-full border-l-2 border-l-primary/40 hover:border-l-primary hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 bg-card/80">
      <CardHeader className="pb-2 space-y-1.5">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium leading-snug hover:text-primary transition-colors line-clamp-2"
        >
          {result.title}
        </a>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className="text-[10px] font-medium border px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">
            {domain}
          </Badge>
          {contentType && (
            <Badge variant="outline" className="text-[10px] font-normal gap-1 px-1.5 py-0 h-4">
              {contentType.emoji} {contentType.label}
            </Badge>
          )}
          {date && (
            <span className="text-[10px] text-muted-foreground tabular-nums">{date}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground leading-relaxed">{excerpt}</p>
      </CardContent>
    </Card>
  );
}
