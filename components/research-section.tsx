'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useState, FormEvent, useEffect, useRef } from 'react';
import { SearchForm } from '@/components/search-form';
import { ResearchDisplay } from '@/components/research-display';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { saveResearchSession } from '@/lib/history-client';
import { getBrowserTimezone } from '@/lib/date-utils';
import { blockedRunMessage, notifyUsageChanged } from '@/lib/usage-client';
import { useBudgetGate } from '@/components/budget-gate';
import { RunCostHint } from '@/components/run-cost-hint';

// Timezone header: the server enforces the daily budget on the user's local day.
const transport = new DefaultChatTransport({
  api: '/api/research',
  headers: () => ({ 'X-Timezone': getBrowserTimezone() }),
});

/** The server answers a blocked run with JSON ({error: 'rate_limited' | 'budget_exceeded'}); show it in words. */
function friendlyError(error: Error | undefined): Error | undefined {
  if (!error) return error;
  try {
    const message = blockedRunMessage(JSON.parse(error.message));
    if (message) return new Error(message);
  } catch {
    // not JSON — keep the original error
  }
  return error;
}

interface ResearchSectionProps {
  sessionId: string;
  initialMessages?: UIMessage[];
  focusInput?: boolean;
  onSessionSaved?: (id: string, title: string) => void;
  onReset?: () => void;
}

export function ResearchSection({
  sessionId,
  initialMessages = [],
  focusInput,
  onSessionSaved,
  onReset,
}: ResearchSectionProps) {
  const [query, setQuery] = useState('');
  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    messages: initialMessages,
  });
  const isLoading = status === 'submitted' || status === 'streaming';
  const { ensureBudget } = useBudgetGate();

  // Refresh the usage meter when a run ends (finished, stopped or failed).
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) notifyUsageChanged();
    wasLoadingRef.current = isLoading;
  }, [isLoading]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-save: debounce 1.5s after messages settle
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const title =
        firstUserMsg?.parts.find((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')?.text?.slice(0, 80) ??
        'Untitled session';
      saveResearchSession(sessionId, title, messages as unknown[]);
      onSessionSaved?.(sessionId, title);
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionId]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    if (!(await ensureBudget('deep_research'))) return;
    sendMessage({ text: query });
    setQuery('');
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold text-center mb-2">Deep Research Agent</h1>
        <p className="text-muted-foreground text-sm text-center mb-8">
          Ask anything — the agent searches the web and synthesizes a comprehensive answer.
        </p>
        <SearchForm
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          onStop={stop}
          label="Research question"
          focusInput={focusInput}
        />
        <RunCostHint feature="deep_research" className="mt-1 text-right" />
        {messages.length > 0 && onReset && (
          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={onReset}
              disabled={isLoading}
            >
              <RotateCcw className="h-3 w-3" />
              New session
            </Button>
          </div>
        )}
        <ScrollArea className="mt-6">
          <ResearchDisplay messages={messages} isLoading={isLoading} error={friendlyError(error)} />
          <div ref={bottomRef} />
        </ScrollArea>
      </div>
    </main>
  );
}
