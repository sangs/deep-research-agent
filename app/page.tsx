'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, FormEvent, useEffect, useRef } from 'react';
import { SearchForm } from '@/components/search-form';
import { ResearchDisplay } from '@/components/research-display';
import { ScrollArea } from '@/components/ui/scroll-area';

const transport = new DefaultChatTransport({ api: '/api/research' });

export default function Home() {
  const [query, setQuery] = useState('');
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages update or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
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
        />
        <ScrollArea className="mt-6">
          <ResearchDisplay messages={messages} isLoading={isLoading} error={error} />
          <div ref={bottomRef} />
        </ScrollArea>
      </div>
    </main>
  );
}
