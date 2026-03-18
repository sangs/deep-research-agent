'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Mail, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

/** Strip protocol, www., and trailing slashes so users can paste full URLs. */
function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, ''); // drop any path
}


interface SourceManagerProps {
  open: boolean;
  onClose: () => void;
}

export function SourceManager({ open, onClose }: SourceManagerProps) {
  const [domains, setDomains] = useState<string[]>([]);
  const [researchDomains, setResearchDomains] = useState<string[]>([]);
  const [newsletterDomains, setNewsletterDomains] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [researchInputValue, setResearchInputValue] = useState('');
  const [newsletterInputValue, setNewsletterInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingNews, setSavingNews] = useState(false);
  const [savingResearch, setSavingResearch] = useState(false);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [newsletterError, setNewsletterError] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchSources();
  }, [open]);

  async function fetchSources() {
    setLoading(true);
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      setDomains(data.news_sites ?? []);
      setResearchDomains(data.research_sites ?? []);
      setNewsletterDomains(data.newsletters ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function addDomain() {
    const normalized = normalizeDomain(inputValue);
    if (!normalized) return;
    if (domains.includes(normalized)) {
      setNewsError(`${normalized} is already in the list.`);
      return;
    }
    setNewsError(null);
    setSavingNews(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', domains: [normalized], list_type: 'news_sites' }),
      });
      if (res.ok) {
        setDomains((prev) => [...prev, normalized]);
        setInputValue('');
      } else {
        setNewsError('Failed to save. Is the backend running?');
      }
    } catch {
      setNewsError('Network error — could not reach the backend.');
    } finally {
      setSavingNews(false);
    }
  }

  async function removeDomain(domain: string) {
    setNewsError(null);
    setSavingNews(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', domains: [domain], list_type: 'news_sites' }),
      });
      if (res.ok) {
        setDomains((prev) => prev.filter((d) => d !== domain));
      } else {
        setNewsError('Failed to remove. Is the backend running?');
      }
    } catch {
      setNewsError('Network error — could not reach the backend.');
    } finally {
      setSavingNews(false);
    }
  }

  async function addResearchDomain() {
    const normalized = normalizeDomain(researchInputValue);
    if (!normalized) return;
    if (researchDomains.includes(normalized)) {
      setResearchError(`${normalized} is already in the list.`);
      return;
    }
    setResearchError(null);
    setSavingResearch(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', domains: [normalized], list_type: 'research_sites' }),
      });
      if (res.ok) {
        setResearchDomains((prev) => [...prev, normalized]);
        setResearchInputValue('');
      } else {
        setResearchError('Failed to save. Is the backend running?');
      }
    } catch {
      setResearchError('Network error — could not reach the backend.');
    } finally {
      setSavingResearch(false);
    }
  }

  async function removeResearchDomain(domain: string) {
    setResearchError(null);
    setSavingResearch(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', domains: [domain], list_type: 'research_sites' }),
      });
      if (res.ok) {
        setResearchDomains((prev) => prev.filter((d) => d !== domain));
      } else {
        setResearchError('Failed to remove. Is the backend running?');
      }
    } catch {
      setResearchError('Network error — could not reach the backend.');
    } finally {
      setSavingResearch(false);
    }
  }

  async function addNewsletterDomain() {
    const normalized = normalizeDomain(newsletterInputValue);
    if (!normalized) return;
    if (newsletterDomains.includes(normalized)) {
      setNewsletterError(`${normalized} is already in the list.`);
      return;
    }
    setNewsletterError(null);
    setSavingNewsletter(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', domains: [normalized], list_type: 'newsletters' }),
      });
      if (res.ok) {
        setNewsletterDomains((prev) => [...prev, normalized]);
        setNewsletterInputValue('');
      } else {
        setNewsletterError('Failed to save. Is the backend running?');
      }
    } catch {
      setNewsletterError('Network error — could not reach the backend.');
    } finally {
      setSavingNewsletter(false);
    }
  }

  async function removeNewsletterDomain(domain: string) {
    setNewsletterError(null);
    setSavingNewsletter(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', domains: [domain], list_type: 'newsletters' }),
      });
      if (res.ok) {
        setNewsletterDomains((prev) => prev.filter((d) => d !== domain));
      } else {
        setNewsletterError('Failed to remove. Is the backend running?');
      }
    } catch {
      setNewsletterError('Network error — could not reach the backend.');
    } finally {
      setSavingNewsletter(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-sm">Manage Sources</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-5">

          {/* ── News Sites & Blogs ─────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold">News Sites & Blogs</p>
              <p className="text-xs text-muted-foreground">
                Used by the <strong>News Sites & Blogs</strong> panel — Exa-indexed, accessible articles.
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. techcrunch.com or paste a full URL"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setNewsError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                className="text-xs h-8"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={addDomain}
                disabled={savingNews || !inputValue.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {newsError && (
              <div className="flex items-center gap-1.5 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {newsError}
              </div>
            )}

            <ScrollArea className="h-48">
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
              ) : (
                <div className="space-y-1">
                  {domains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted group"
                    >
                      <span className="text-xs font-mono">{domain}</span>
                      <button
                        onClick={() => removeDomain(domain)}
                        className="opacity-0 group-hover:opacity-100 text-destructive transition-opacity"
                        disabled={savingNews}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {domains.length === 0 && !loading && (
                    <p className="text-xs text-muted-foreground text-center py-4">No sources yet.</p>
                  )}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {domains.length} site{domains.length !== 1 ? 's' : ''} · Changes save automatically
            </p>
          </div>

          <Separator />

          {/* ── Research Sites ─────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold">Research Sites</p>
              <p className="text-xs text-muted-foreground">
                Used by the <strong>Research</strong> panel — AI labs, paper repositories, and technical blogs.
                Time filters are not applied when searching them.
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. arxiv.org or paste a full URL"
                value={researchInputValue}
                onChange={(e) => { setResearchInputValue(e.target.value); setResearchError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && addResearchDomain()}
                className="text-xs h-8"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={addResearchDomain}
                disabled={savingResearch || !researchInputValue.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {researchError && (
              <div className="flex items-center gap-1.5 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {researchError}
              </div>
            )}

            <ScrollArea className="h-48">
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
              ) : (
                <div className="space-y-1">
                  {researchDomains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted group"
                    >
                      <span className="text-xs font-mono">{domain}</span>
                      <button
                        onClick={() => removeResearchDomain(domain)}
                        className="opacity-0 group-hover:opacity-100 text-destructive transition-opacity"
                        disabled={savingResearch}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {researchDomains.length === 0 && !loading && (
                    <p className="text-xs text-muted-foreground text-center py-4">No sources yet.</p>
                  )}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {researchDomains.length} site{researchDomains.length !== 1 ? 's' : ''} · Changes save automatically
            </p>
          </div>

          <Separator />

          {/* ── Newsletter Senders ──────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold">Newsletter Senders</p>
              <p className="text-xs text-muted-foreground">
                Used by the <strong>Newsletter</strong> panel as default Gmail{' '}
                <code className="text-[10px] bg-muted px-1 rounded">from:</code> filters.
                Enter a sender domain — any address at that domain matches (e.g.{' '}
                <code className="text-[10px] bg-muted px-1 rounded">tldrnewsletter.com</code> matches{' '}
                <code className="text-[10px] bg-muted px-1 rounded">dan@tldrnewsletter.com</code>).
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. tldrnewsletter.com or hello@substack.com"
                value={newsletterInputValue}
                onChange={(e) => { setNewsletterInputValue(e.target.value); setNewsletterError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && addNewsletterDomain()}
                className="text-xs h-8"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={addNewsletterDomain}
                disabled={savingNewsletter || !newsletterInputValue.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {newsletterError && (
              <div className="flex items-center gap-1.5 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {newsletterError}
              </div>
            )}

            <ScrollArea className="h-48">
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
              ) : (
                <div className="space-y-1">
                  {newsletterDomains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted group"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs font-mono truncate">{domain}</span>
                      </div>
                      <button
                        onClick={() => removeNewsletterDomain(domain)}
                        className="opacity-0 group-hover:opacity-100 text-destructive transition-opacity flex-shrink-0"
                        disabled={savingNewsletter}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {newsletterDomains.length === 0 && !loading && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No senders configured — Newsletter tab will fetch all emails in the date range.
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {newsletterDomains.length} sender{newsletterDomains.length !== 1 ? 's' : ''} · Changes save automatically
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
