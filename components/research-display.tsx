'use client';

import { useState } from 'react';
import { UIMessage } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { SourceCard } from '@/components/source-card';

interface SourceResult {
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate: string | null;
  score: number | null;
}

/** Split markdown text into a Key Takeaways block and the body that follows. */
function extractSummary(text: string): { takeawaysContent: string; body: string } | null {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.match(/^#{1,2}\s*Key Takeaways/i));
  if (idx === -1) return null;

  // Find where the next ## / # section begins after the heading
  let splitIdx = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].match(/^#{1,2}\s+\S/)) { splitIdx = i; break; }
  }

  // Strip the "## Key Takeaways" heading line — the card header already labels it
  const takeawaysContent = lines.slice(idx + 1, splitIdx).join('\n').trim();
  // Any preamble text before the heading + remaining sections after takeaways
  const preamble = lines.slice(0, idx).join('\n').trim();
  const rest = lines.slice(splitIdx).join('\n').trim();
  const body = [preamble, rest].filter(Boolean).join('\n\n').trim();

  return takeawaysContent ? { takeawaysContent, body } : null;
}

function ResearchTextPart({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true);
  const split = extractSummary(text);

  // No structured Key Takeaways section — render as-is (backward compatible)
  if (!split || !split.body) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Key Takeaways summary card */}
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            ✨ Key Takeaways
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="h-3.5 w-3.5" />Collapse</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5" />Read full report</>
            )}
          </button>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{split.takeawaysContent}</ReactMarkdown>
        </div>
      </div>

      {/* Full report — toggled */}
      {expanded && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{split.body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

interface ResearchDisplayProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error;
}

function getUserText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join(' ');
}

export function ResearchDisplay({ messages, isLoading, error }: ResearchDisplayProps) {
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const userMessages = messages.filter((m) => m.role === 'user');

  // First query, nothing yet
  if (isLoading && assistantMessages.length === 0) {
    return (
      <div className="space-y-3 mt-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    );
  }

  if (assistantMessages.length === 0 && !error) return null;

  // Pair each assistant message with the preceding user question
  const pairs = assistantMessages.map((msg, i) => ({
    question: userMessages[i] ? getUserText(userMessages[i]) : null,
    assistant: msg,
  }));

  // The latest user question that has no assistant reply yet (follow-up in progress)
  const pendingUserQuestion =
    isLoading && userMessages.length > assistantMessages.length
      ? getUserText(userMessages[userMessages.length - 1])
      : null;

  return (
    <div className="space-y-8 mt-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <strong>Error:</strong> {error.message}
        </div>
      )}

      {pairs.map(({ question, assistant }, msgIdx) => (
        <div key={assistant.id ?? msgIdx} className="space-y-4">
          {msgIdx > 0 && <Separator />}

          {/* Show the user question above each answer */}
          {question && (
            <p className="text-sm font-semibold text-muted-foreground border-l-2 border-primary pl-3">
              {question}
            </p>
          )}

          {assistant.parts.map((part, partIdx) => {
            if (part.type === 'text') {
              return (
                <ResearchTextPart key={partIdx} text={(part as { type: 'text'; text: string }).text} />
              );
            }

            if (part.type === 'tool-webSearch') {
              const toolPart = part as unknown as {
                type: 'tool-webSearch';
                state: string;
                input?: { query: string; numResults?: number };
                output?: SourceResult[];
                errorText?: string;
              };

              if (toolPart.state === 'input-streaming') {
                return (
                  <div key={partIdx} className="flex items-center gap-2">
                    <Badge variant="secondary" className="animate-pulse text-xs">
                      <span className="mr-1">🔍</span> Preparing search…
                    </Badge>
                  </div>
                );
              }

              if (toolPart.state === 'input-available') {
                return (
                  <div key={partIdx} className="flex items-center gap-2">
                    <Badge variant="secondary" className="animate-pulse text-xs">
                      <span className="mr-1">🔍</span> Searching:{' '}
                      <span className="font-medium ml-1">{toolPart.input?.query}</span>
                    </Badge>
                  </div>
                );
              }

              if (toolPart.state === 'output-available') {
                const results: SourceResult[] = Array.isArray(toolPart.output)
                  ? toolPart.output
                  : [];
                return (
                  <div key={partIdx} className="space-y-2">
                    <Badge variant="outline" className="text-xs">
                      <span className="mr-1">✓</span>
                      {results.length} source{results.length !== 1 ? 's' : ''} found for &quot;
                      {toolPart.input?.query}&quot;
                    </Badge>
                    {results.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {results.map((result, i) => (
                          <SourceCard key={i} result={result} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              if (toolPart.state === 'output-error') {
                return (
                  <div key={partIdx}>
                    <Badge variant="destructive" className="text-xs">
                      Search failed: {toolPart.errorText ?? 'Unknown error'}
                    </Badge>
                  </div>
                );
              }
            }

            return null;
          })}
        </div>
      ))}

      {/* Follow-up query in progress — no assistant reply yet */}
      {pendingUserQuestion && (
        <div className="space-y-3">
          <Separator />
          <p className="text-sm font-semibold text-muted-foreground border-l-2 border-primary pl-3">
            {pendingUserQuestion}
          </p>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )}
    </div>
  );
}
