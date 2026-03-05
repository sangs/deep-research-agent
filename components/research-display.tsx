'use client';

import { useState } from 'react';
import { UIMessage } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { Components } from 'react-markdown';
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

/** Custom heading/paragraph components so headings are clearly larger than body copy. */
const mdComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-bold mt-5 mb-2 text-foreground">{children}</h1>,
  h2: ({ children }) => {
    const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return <h2 id={id} className="text-xl font-bold mt-4 mb-2 text-foreground">{children}</h2>;
  },
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-3 mb-1 text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-1 text-foreground">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-semibold mt-2 mb-1 text-foreground">{children}</h6>,
  p:  ({ children }) => <p className="text-sm leading-relaxed mb-2 text-foreground/90">{children}</p>,
};

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

function extractHeadings(text: string): { text: string; id: string }[] {
  return text
    .split('\n')
    .filter(l => l.match(/^## /))
    .map(l => {
      const headingText = l.replace(/^## /, '').trim();
      const id = headingText.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      return { text: headingText, id };
    });
}

/** Renders a single tool-webSearch part. */
function ToolSearchPart({ part, partIdx }: { part: unknown; partIdx: number }) {
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
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="animate-pulse text-xs">
          <span className="mr-1">🔍</span> Searching:{' '}
          <span className="font-medium ml-1">{toolPart.input?.query}</span>
        </Badge>
      </div>
    );
  }

  if (toolPart.state === 'output-available') {
    const results: SourceResult[] = Array.isArray(toolPart.output) ? toolPart.output : [];
    return (
      <div className="space-y-2">
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
      <div>
        <Badge variant="destructive" className="text-xs">
          Search failed: {toolPart.errorText ?? 'Unknown error'}
        </Badge>
      </div>
    );
  }

  return null;
}

/**
 * Renders all parts of a single assistant message.
 * Expand/collapse is managed here so that clicking "Collapse" hides ALL parts
 * (text narrative + source cards), not just the text portion.
 */
function MessageBlock({ parts }: { parts: UIMessage['parts'] }) {
  const [expanded, setExpanded] = useState(true);

  // Find the text part that contains Key Takeaways
  const takeawaysInfo = (() => {
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx];
      if (part.type === 'text') {
        const s = extractSummary((part as { type: 'text'; text: string }).text);
        if (s) return { split: s, partIdx: idx };
      }
    }
    return null;
  })();

  const headings = takeawaysInfo ? extractHeadings(takeawaysInfo.split.body) : [];

  // No Key Takeaways found — render all parts as-is with no collapse UI
  if (!takeawaysInfo) {
    return (
      <div className="space-y-4">
        {parts.map((part, partIdx) => {
          if (part.type === 'text') {
            const text = (part as { type: 'text'; text: string }).text;
            return (
              <div key={partIdx} className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type === 'tool-webSearch') {
            return <ToolSearchPart key={partIdx} part={part} partIdx={partIdx} />;
          }
          return null;
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section navigation chips — shown when there are ≥2 h2 headings */}
      {headings.length >= 2 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {headings.map((h) => (
            <button
              key={h.id}
              onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="inline-flex items-center gap-1 text-xs font-normal py-0 h-5 px-2 rounded-full border border-border bg-background hover:border-primary hover:text-primary transition-colors cursor-pointer"
            >
              <Search className="h-2.5 w-2.5" />
              {h.text}
            </button>
          ))}
        </div>
      )}

      {/* Key Takeaways card — always visible */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            ✨ Key Takeaways
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary/80 hover:text-primary transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="h-3.5 w-3.5" />Collapse</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5" />Read full report</>
            )}
          </button>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{takeawaysInfo.split.takeawaysContent}</ReactMarkdown>
        </div>
      </div>

      {/* Full report — ALL parts gated behind expanded */}
      {expanded && (
        <div className="space-y-4">
          {parts.map((part, partIdx) => {
            if (part.type === 'text') {
              const text = (part as { type: 'text'; text: string }).text;
              // For the Key Takeaways part, render body-only to avoid duplication
              const renderText = partIdx === takeawaysInfo.partIdx ? takeawaysInfo.split.body : text;
              if (!renderText) return null;
              return (
                <div key={partIdx} className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{renderText}</ReactMarkdown>
                </div>
              );
            }
            if (part.type === 'tool-webSearch') {
              return <ToolSearchPart key={partIdx} part={part} partIdx={partIdx} />;
            }
            return null;
          })}
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

          <MessageBlock parts={assistant.parts} />
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
