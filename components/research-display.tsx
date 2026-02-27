import { UIMessage } from 'ai';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { SourceCard } from '@/components/source-card';

interface SourceResult {
  title: string;
  url: string;
  text: string;
  publishedDate: string | null;
  score: number | null;
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
                <div key={partIdx} className="prose prose-sm dark:prose-invert max-w-none">
                  {part.text.split('\n').map((line, lineIdx) => {
                    if (line.startsWith('## ')) {
                      return (
                        <h2 key={lineIdx} className="text-lg font-semibold mt-4 mb-2">
                          {line.slice(3)}
                        </h2>
                      );
                    }
                    if (line.startsWith('# ')) {
                      return (
                        <h1 key={lineIdx} className="text-xl font-bold mt-4 mb-2">
                          {line.slice(2)}
                        </h1>
                      );
                    }
                    if (line.startsWith('### ')) {
                      return (
                        <h3 key={lineIdx} className="text-base font-semibold mt-3 mb-1">
                          {line.slice(4)}
                        </h3>
                      );
                    }
                    if (line.startsWith('- ') || line.startsWith('* ')) {
                      return (
                        <li key={lineIdx} className="ml-4 text-sm">
                          {line.slice(2)}
                        </li>
                      );
                    }
                    if (line.trim() === '') return <br key={lineIdx} />;
                    return (
                      <p key={lineIdx} className="text-sm leading-relaxed">
                        {line}
                      </p>
                    );
                  })}
                </div>
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
