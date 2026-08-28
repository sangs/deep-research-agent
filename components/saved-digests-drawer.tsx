'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, LockOpen, Bookmark, Pencil, Check, Loader2, Tag, Plus } from 'lucide-react';
import { formatRelativeTime } from '@/lib/date-utils';
import { listSavedDigests, renameDigest, updateDigestTags, clearCachedDigest } from '@/lib/history-client';
import type { SavedDigestMeta } from '@/lib/history-client';

/** The mandatory YYYY-MM-DD (or YYYY-MM-DD_YYYY-MM-DD for a multi-day range)
 *  suffix every saved digest's name carries — never editable, never omitted,
 *  so the date a digest covers is always visible regardless of what custom
 *  name (if any) the user gives it. */
function dateSuffix(item: SavedDigestMeta): string {
  if (!item.rangeStart) return '';
  return item.rangeEnd && item.rangeEnd !== item.rangeStart
    ? `${item.rangeStart}_${item.rangeEnd}`
    : item.rangeStart;
}

/** Full displayed name: custom label (if any) + the mandatory date suffix, or
 *  just the date suffix when no custom name has been set. */
function displayName(item: SavedDigestMeta): string {
  const suffix = dateSuffix(item);
  return item.label ? `${item.label} ${suffix}` : suffix || 'Newsletter digest';
}

interface SavedDigestsDrawerProps {
  open: boolean;
  mode: string;
  onClose: () => void;
  onSelect: (cacheKey: string) => void;
}

export function SavedDigestsDrawer({ open, mode, onClose, onSelect }: SavedDigestsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<SavedDigestMeta[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [taggingKey, setTaggingKey] = useState<string | null>(null);
  const [tagInputValue, setTagInputValue] = useState('');

  // Fetch page 1 whenever the drawer opens
  useEffect(() => {
    if (open) fetchFirstPage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function fetchFirstPage() {
    setLoading(true);
    const { items, hasMore } = await listSavedDigests(mode);
    setItems(items);
    setHasMore(hasMore);
    setLoading(false);
  }

  async function loadMore() {
    setLoading(true);
    const { items: more, hasMore: nextHasMore } = await listSavedDigests(mode, items.length);
    setItems((prev) => [...prev, ...more]);
    setHasMore(nextHasMore);
    setLoading(false);
  }

  async function handleUnlock(cacheKey: string) {
    await clearCachedDigest(cacheKey);
    setItems((prev) => prev.filter((i) => i.cacheKey !== cacheKey));
  }

  function startRename(item: SavedDigestMeta) {
    setEditingKey(item.cacheKey);
    // Only the custom part is editable — the date suffix always re-appends on save
    setEditValue(item.label ?? '');
  }

  async function commitRename(cacheKey: string) {
    const label = editValue.trim() || null;
    await renameDigest(cacheKey, label);
    setItems((prev) => prev.map((i) => (i.cacheKey === cacheKey ? { ...i, label } : i)));
    setEditingKey(null);
  }

  function startAddTag(cacheKey: string) {
    setTaggingKey(cacheKey);
    setTagInputValue('');
  }

  async function commitAddTag(item: SavedDigestMeta) {
    const tag = tagInputValue.trim();
    if (!tag || item.tags.includes(tag)) {
      setTagInputValue('');
      return;
    }
    const nextTags = [...item.tags, tag];
    await updateDigestTags(item.cacheKey, nextTags);
    setItems((prev) => prev.map((i) => (i.cacheKey === item.cacheKey ? { ...i, tags: nextTags } : i)));
    setTagInputValue('');
  }

  async function removeTag(item: SavedDigestMeta, tag: string) {
    const nextTags = item.tags.filter((t) => t !== tag);
    await updateDigestTags(item.cacheKey, nextTags);
    setItems((prev) => prev.map((i) => (i.cacheKey === item.cacheKey ? { ...i, tags: nextTags } : i)));
  }

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        className={`fixed right-0 top-0 z-50 h-full w-80 bg-background border-l shadow-xl flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Saved digests"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-sm">Saved Digests</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close saved digests"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {items.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <Bookmark className="h-6 w-6 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No digests locked yet.</p>
              <p className="text-xs text-muted-foreground">Lock a digest from the Newsletter tab to save it here.</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.cacheKey}
                className="group flex items-start gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { onSelect(item.cacheKey); onClose(); }}>
                  {editingKey === item.cacheKey ? (
                    <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        placeholder="Custom name (optional)"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(item.cacheKey);
                          if (e.key === 'Escape') setEditingKey(null);
                        }}
                        className="flex-1 min-w-0 text-xs rounded border border-input bg-background px-1.5 py-0.5"
                      />
                      {/* Date suffix is always appended, never editable */}
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{dateSuffix(item)}</span>
                      <button onClick={() => commitRename(item.cacheKey)} className="text-primary shrink-0">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-medium truncate leading-snug">{displayName(item)}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0">
                      {item.articleCount} article{item.articleCount !== 1 ? 's' : ''}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      Locked {formatRelativeTime(item.generatedAt)}
                    </span>
                  </div>
                  {(item.tags.length > 0 || taggingKey === item.cacheKey) && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      {item.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[9px] h-4 px-1.5 py-0 gap-1 border-primary/30 text-primary bg-primary/5"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {tag}
                          <button onClick={() => removeTag(item, tag)} aria-label={`Remove tag ${tag}`}>
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                      {taggingKey === item.cacheKey && (
                        <input
                          autoFocus
                          placeholder="Add tag…"
                          value={tagInputValue}
                          onChange={(e) => setTagInputValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitAddTag(item);
                            if (e.key === 'Escape') setTaggingKey(null);
                          }}
                          onBlur={() => setTaggingKey(null)}
                          className="w-20 text-[10px] rounded border border-input bg-background px-1.5 py-0.5"
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                  {taggingKey !== item.cacheKey && (
                    <button
                      onClick={() => startAddTag(item.cacheKey)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Add tag"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {editingKey !== item.cacheKey && (
                    <button
                      onClick={() => startRename(item)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleUnlock(item.cacheKey)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Unlock"
                  >
                    <LockOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {hasMore && !loading && (
            <div className="px-3 py-2">
              <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
