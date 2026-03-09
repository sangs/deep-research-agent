'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Trash2, Clock, Plus } from 'lucide-react';
import type { SessionMeta } from '@/lib/history-client';

interface HistoryDrawerProps {
  open: boolean;
  sessions: SessionMeta[];
  activeSessionId: string;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
}

function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function HistoryDrawer({
  open,
  sessions,
  activeSessionId,
  onClose,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: HistoryDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed left-0 top-0 z-50 h-full w-72 bg-background border-r shadow-xl flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Session history"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-sm">Research History</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New session button */}
        <div className="px-3 py-2 border-b flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 text-xs h-8"
            onClick={() => {
              onNewSession();
              onClose();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New session
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <Clock className="h-6 w-6 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No past sessions yet.</p>
              <p className="text-xs text-muted-foreground">Run a research query to get started.</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                  session.id === activeSessionId ? 'bg-muted' : ''
                }`}
                onClick={() => {
                  onSelectSession(session.id);
                  onClose();
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-snug">{session.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRelativeTime(session.updatedAt)}
                  </p>
                </div>
                {session.id === activeSessionId && (
                  <Badge variant="secondary" className="text-xs h-4 px-1 py-0 flex-shrink-0 mt-0.5">
                    Active
                  </Badge>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all mt-0.5"
                  aria-label="Delete session"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
