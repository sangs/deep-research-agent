'use client';

// Gmail organizing UI for the Newsletter digest. Every change goes through the
// backend's guarded gmail_organizer (labels only; nothing is ever trashed or
// deleted), is logged, and can be undone from the toast or the activity drawer.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FolderInput, History, Loader2, Tag, Undo2, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { TopicCluster } from '@/components/topic-group';

export const ORGANIZE_PREFIX = 'AI-Digest';

interface GmailLabel { id: string; name: string }
interface GmailAction {
  id: string; kind: string; actor: string; messages: number; labels: string[]; moved: boolean;
  created_at: number; undone_at: number | null; undone_by: string | null;
}
export interface LabelGroup { label: string; message_ids: string[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/gmail/${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** "AI-Digest/Model Releases" from a topic label (Gmail uses "/" for nesting). */
export function topicFolderName(prefix: string, topic: string): string {
  const clean = topic.replace(/\//g, '-').replace(/\s+/g, ' ').trim();
  return prefix.trim() ? `${prefix.trim()}/${clean}` : clean;
}

// ── Shared state ─────────────────────────────────────────────────────────────

interface GmailOrganize {
  available: boolean; // owner + backend reachable
  labels: GmailLabel[];
  selected: Set<string>;
  toggle: (messageId: string) => void;
  clearSelection: () => void;
  apply: (kind: 'move' | 'label' | 'organize', groups: LabelGroup[], move: boolean) => Promise<boolean>;
  openActivity: () => void;
}

const Ctx = createContext<GmailOrganize | null>(null);
export function useGmailOrganize(): GmailOrganize | null {
  return useContext(Ctx);
}

export function GmailOrganizeProvider({ children }: { children: React.ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activityOpen, setActivityOpen] = useState(false);

  const loadLabels = useCallback(async () => {
    try {
      const { labels } = await api<{ labels: GmailLabel[] }>('labels');
      setLabels(labels);
      setAvailable(true);
    } catch {
      setAvailable(false); // not the owner, or Gmail unavailable — hide organize controls
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load from an external system
    loadLabels();
  }, [loadLabels]);

  const undo = useCallback(async (actionId: string) => {
    try {
      const r = await api<{ restored_messages: number }>('undo', { method: 'POST', body: JSON.stringify({ action_id: actionId }) });
      toast.success(`Undone. Restored labels on ${r.restored_messages} email${r.restored_messages === 1 ? '' : 's'}.`);
    } catch (e) {
      toast.error(`Undo failed: ${(e as Error).message}`);
    }
  }, []);

  const apply = useCallback(
    async (kind: 'move' | 'label' | 'organize', groups: LabelGroup[], move: boolean) => {
      try {
        const r = await api<{ action_id: string; messages: number; labels: string[] }>('apply', {
          method: 'POST',
          body: JSON.stringify({ kind, groups, move }),
        });
        const where = r.labels.length === 1 ? r.labels[0] : `${r.labels.length} folders`;
        toast.success(`${move ? 'Moved' : 'Labeled'} ${r.messages} email${r.messages === 1 ? '' : 's'} → ${where}`, {
          duration: 10_000,
          action: { label: 'Undo', onClick: () => undo(r.action_id) },
        });
        setSelected(new Set());
        loadLabels();
        return true;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      }
    },
    [undo, loadLabels],
  );

  const value = useMemo<GmailOrganize>(
    () => ({
      available,
      labels,
      selected,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      clearSelection: () => setSelected(new Set()),
      apply,
      openActivity: () => setActivityOpen(true),
    }),
    [available, labels, selected, apply],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <GmailActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} onUndo={undo} />
    </Ctx.Provider>
  );
}

// ── Folder picker (move / label) ─────────────────────────────────────────────

export function FolderDialog({
  open, mode, messageIds, defaultName, onClose,
}: { open: boolean; mode: 'move' | 'label'; messageIds: string[]; defaultName?: string; onClose: () => void }) {
  const org = useGmailOrganize();
  const [name, setName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  if (!org) return null;
  const count = messageIds.length;

  async function submit(folder: string) {
    if (!folder.trim() || !org) return;
    setBusy(true);
    const ok = await org.apply(mode, [{ label: folder.trim(), message_ids: messageIds }], mode === 'move');
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'move' ? `Move ${count} email${count === 1 ? '' : 's'} to a folder` : `Label ${count} email${count === 1 ? '' : 's'}`}</DialogTitle>
          <DialogDescription>
            {mode === 'move'
              ? 'Adds the folder label and removes them from your Inbox. They stay in All Mail; nothing is deleted. You can undo.'
              : 'Adds the label and keeps them in your Inbox. You can undo.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`New folder, e.g. ${ORGANIZE_PREFIX}/Agents`}
              onKeyDown={(e) => e.key === 'Enter' && submit(name)}
              aria-label="Folder name"
            />
            <Button onClick={() => submit(name)} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'move' ? 'Move' : 'Label'}
            </Button>
          </div>
          {org.labels.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Or pick an existing folder</p>
              <ul className="max-h-56 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
                {org.labels.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit(l.name)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 disabled:opacity-50"
                    >
                      {l.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Organize inbox (digest-wide) ─────────────────────────────────────────────

function groupsFromTopics(topics: TopicCluster[], prefix: string): LabelGroup[] {
  return topics
    .map((t) => ({
      label: topicFolderName(prefix, t.label),
      message_ids: t.articles.map((a) => a.message_id).filter((id): id is string => !!id),
    }))
    .filter((g) => g.message_ids.length > 0);
}

export function OrganizeInboxButton({ topics }: { topics: TopicCluster[] }) {
  const org = useGmailOrganize();
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState(ORGANIZE_PREFIX);
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupsFromTopics(topics, prefix), [topics, prefix]);
  if (!org?.available) return null;
  const total = groups.reduce((n, g) => n + g.message_ids.length, 0);
  const disabled = total === 0;

  async function applyAll() {
    if (!org) return;
    setBusy(true);
    const ok = await org.apply('organize', groups, move);
    setBusy(false);
    if (ok) setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'Re-run this digest to organize it (older saved digests don’t include email IDs)' : 'Label every email by its topic'}
      >
        <Wand2 className="h-3 w-3" /> Organize inbox…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Organize inbox by topic</DialogTitle>
            <DialogDescription>
              Will label {total} email{total === 1 ? '' : 's'} into {groups.length} folder{groups.length === 1 ? '' : 's'}. Nothing is deleted, and you can undo the whole step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground shrink-0">Folder prefix</span>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-8" aria-label="Folder prefix" />
            </label>
            <ul className="max-h-60 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40 text-sm">
              {groups.map((g) => (
                <li key={g.label} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="truncate">{g.label}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">{g.message_ids.length}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={move} onChange={(e) => setMove(e.target.checked)} />
              <span>Also move them out of the Inbox (archive into these folders). Off: label only, the Inbox stays as is.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={applyAll} disabled={busy || disabled}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {move ? 'Organize & move' : 'Apply labels'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GmailActivityButton() {
  const org = useGmailOrganize();
  if (!org?.available) return null;
  return (
    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={org.openActivity}>
      <History className="h-3 w-3" /> Gmail activity
    </Button>
  );
}

// ── Selection bar (bulk actions) ─────────────────────────────────────────────

export function SelectionBar() {
  const org = useGmailOrganize();
  const [dialog, setDialog] = useState<'move' | 'label' | null>(null);
  if (!org?.available || org.selected.size === 0) return null;
  const ids = [...org.selected];
  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected emails"
        className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-popover px-4 py-2 text-sm shadow-lg"
      >
        <span className="font-medium tabular-nums">{ids.length} selected</span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setDialog('move')}>
          <FolderInput className="h-3.5 w-3.5" /> Move to…
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setDialog('label')}>
          <Tag className="h-3.5 w-3.5" /> Label…
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={org.clearSelection} aria-label="Clear selection">
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
      {dialog && <FolderDialog open mode={dialog} messageIds={ids} onClose={() => setDialog(null)} />}
    </>
  );
}

// ── Activity drawer (audit log + undo) ───────────────────────────────────────

function GmailActivityDrawer({ open, onClose, onUndo }: { open: boolean; onClose: () => void; onUndo: (id: string) => Promise<void> }) {
  const [actions, setActions] = useState<GmailAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setActions((await api<{ actions: GmailAction[] }>('actions?limit=50')).actions);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh from an external system when opened
    if (open) load();
  }, [open, load]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] sm:w-[520px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Gmail activity</SheetTitle>
          <p className="text-xs text-muted-foreground">Every label or move this app made. Undo puts back exactly the labels an action changed.</p>
        </SheetHeader>
        {error && <p className="text-sm text-[#d03b3b]">{error}</p>}
        {actions?.length === 0 && <p className="text-sm text-muted-foreground">No Gmail changes yet.</p>}
        <ul className="space-y-3 px-1">
          {actions?.map((a) => (
            <li key={a.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {a.moved ? 'Moved' : 'Labeled'} {a.messages} email{a.messages === 1 ? '' : 's'}
                    {a.kind === 'organize' && ' (organize by topic)'}
                  </p>
                  <p className="text-muted-foreground truncate" title={a.labels.join(', ')}>→ {a.labels.join(', ')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(a.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {a.actor}
                    {a.undone_at && <> · undone {new Date(a.undone_at).toLocaleTimeString([], { timeStyle: 'short' })}</>}
                  </p>
                </div>
                {!a.undone_at && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 shrink-0" onClick={async () => { await onUndo(a.id); load(); }}>
                    <Undo2 className="h-3 w-3" /> Undo
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
