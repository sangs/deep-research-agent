'use client';

import { useState, useEffect, useCallback } from 'react';
import { type UIMessage } from 'ai';
import { useSection } from '@/context/section-context';
import { NewsHubSection } from '@/components/news-hub-section';
import { ResearchSection } from '@/components/research-section';
import { HistoryDrawer } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { History } from 'lucide-react';
import {
  listResearchSessions,
  loadResearchSession,
  deleteResearchSession,
  clearAllResearchSessions,
  type SessionMeta,
} from '@/lib/history-client';

export default function Home() {
  const { section } = useSection();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);

  // Generate session ID on mount (client-only)
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  // Load session list on mount
  useEffect(() => {
    listResearchSessions().then(setSessions);
  }, []);

  const handleSessionSaved = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const exists = prev.find((s) => s.id === id);
      const now = Math.floor(Date.now() / 1000);
      if (exists) {
        return prev.map((s) => (s.id === id ? { ...s, title, updatedAt: now } : s));
      }
      return [{ id, title, createdAt: now, updatedAt: now }, ...prev];
    });
  }, []);

  async function handleSelectSession(id: string) {
    const msgs = await loadResearchSession(id);
    if (msgs) {
      setInitialMessages(msgs as UIMessage[]);
      setSessionId(id);
    }
  }

  async function handleDeleteSession(id: string) {
    await deleteResearchSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // If the deleted session was active, start a new one
    if (id === sessionId) {
      setInitialMessages([]);
      setSessionId(crypto.randomUUID());
    }
  }

  function handleNewSession() {
    setInitialMessages([]);
    setSessionId(crypto.randomUUID());
  }

  async function handleClearAllSessions() {
    await clearAllResearchSessions();
    setSessions([]);
    setInitialMessages([]);
    setSessionId(crypto.randomUUID());
  }

  return (
    <>
      {/* History button — only shown in research section */}
      {section === 'research' && sessionId && (
        <div className="fixed top-16 left-4 z-60">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
            onClick={() => setDrawerOpen(true)}
          >
            <History className="h-3.5 w-3.5" />
            History
          </Button>
        </div>
      )}

      <HistoryDrawer
        open={drawerOpen}
        sessions={sessions}
        activeSessionId={sessionId}
        onClose={() => setDrawerOpen(false)}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSession={handleNewSession}
        onClearAll={handleClearAllSessions}
      />

      <div className={section === 'research' ? '' : 'hidden'}>
        {/* key forces remount when session changes, so useChat gets fresh initialMessages */}
        {sessionId && (
          <ResearchSection
            key={sessionId}
            sessionId={sessionId}
            initialMessages={initialMessages}
            focusInput={section === 'research'}
            onSessionSaved={handleSessionSaved}
            onReset={handleNewSession}
          />
        )}
      </div>

      <div className={section === 'news' ? '' : 'hidden'}>
        <NewsHubSection />
      </div>
    </>
  );
}
