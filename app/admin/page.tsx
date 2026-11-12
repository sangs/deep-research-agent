'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatUsd } from '@/lib/usage-client';
import { formatRelativeTime } from '@/lib/date-utils';

// Owner console: approve access requests, pre-approve emails, suspend or
// reactivate members. Shows account and spend only, never anyone's content.

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'member' | 'system';
  status: 'pending' | 'active' | 'suspended' | 'deleting';
  createdAt: number;
  lastLoginAt: number | null;
  linked: boolean;
  spentTodayUsd: number;
  spent30dUsd: number;
  deletionDueAt: number | null;
  gmailEnabled: boolean;
  gmailStatus: 'active' | 'reauth_required' | 'disconnected' | null;
}

interface GmailCap {
  used: number;
  limit: number;
  guard: number;
}

type Action =
  | 'approve' | 'reject' | 'suspend' | 'reactivate' | 'delete' | 'cancel_deletion'
  | 'enable_gmail' | 'disable_gmail';

const GMAIL_LABEL: Record<string, string> = {
  active: 'connected',
  reauth_required: 'needs reconnecting',
  disconnected: 'disconnected',
};

const STATUS_STYLE: Record<AdminUser['status'], string> = {
  pending: 'bg-[#fab219]/15 text-foreground border-[#fab219]/40',
  active: 'bg-[#0ca30c]/15 text-foreground border-[#0ca30c]/40',
  suspended: 'bg-muted text-muted-foreground border-border',
  deleting: 'bg-[#d03b3b]/10 text-foreground border-[#d03b3b]/40',
};

function when(ms: number | null): string {
  return ms ? formatRelativeTime(Math.floor(ms / 1000)) : '—';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [gmailCap, setGmailCap] = useState<GmailCap | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? `Could not load users (HTTP ${res.status})`);
    setUsers(body.users);
    setGmailCap(body.gmailCap ?? null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(key: string, payload: Record<string, string>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Request failed (HTTP ${res.status})`);
        return false;
      }
      setUsers(body.users);
      setGmailCap(body.gmailCap ?? null);
      return true;
    } finally {
      setBusy(null);
    }
  }

  const act = (u: AdminUser, action: Action) => send(`${u.id}:${action}`, { action, userId: u.id });

  const pending = users?.filter((u) => u.status === 'pending') ?? [];
  const accounts = users?.filter((u) => u.status !== 'pending') ?? [];

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Each account is private: you see who has access and what it costs, never anyone&apos;s research, digests, sources or email.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {gmailCap && (
        <Section title="Gmail connections">
          <p className="text-sm">
            <span className="font-medium tabular-nums">
              {gmailCap.used} of {gmailCap.limit}
            </span>{' '}
            <span className="text-muted-foreground">
              used (lifetime). Google lets at most {gmailCap.limit} accounts ever connect Gmail to this unverified app;
              disconnecting doesn&apos;t give a slot back. New connections stop at {gmailCap.guard}, keeping a reserve.
            </span>
          </p>
          <div className="mt-2 h-1.5 w-full max-w-56 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${gmailCap.used >= gmailCap.guard ? 'bg-[#d03b3b]' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, (gmailCap.used / gmailCap.limit) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Turn Gmail on per member below (only for people who need the Newsletter tab). Turning it off stops their Gmail
            use at once; their connection stays until they disconnect it.
          </p>
        </Section>
      )}

      <Section title="Pre-approve an email">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send('preapprove', { action: 'preapprove', email })) setEmail('');
          }}
        >
          <Input
            type="email"
            required
            placeholder="name@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={busy === 'preapprove'}>
            Pre-approve
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          The account is active the first time this Google account signs in.
        </p>
      </Section>

      <Section title={`Access requests (${pending.length})`}>
        {!users ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {pending.map((u) => (
              <li key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.name ?? 'No name'} · requested {when(u.createdAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => act(u, 'approve')} disabled={!!busy}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(u, 'reject')} disabled={!!busy}>
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Accounts">
        {!users ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/60">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Gmail</th>
                  <th className="py-2 pr-3 font-medium">Last sign-in</th>
                  <th className="py-2 pr-3 font-medium text-right">Today (UTC)</th>
                  <th className="py-2 pr-3 font-medium text-right">30 days</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {accounts.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{u.role === 'system' ? u.name : u.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {u.role === 'owner' ? 'Owner' : u.role === 'system' ? 'System' : u.linked ? 'Member' : 'Pre-approved, not signed in yet'}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {u.role !== 'system' && (
                        <Badge variant="outline" className={STATUS_STYLE[u.status]}>
                          {u.status}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {u.role === 'system' ? null : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-xs text-muted-foreground">
                            {u.role === 'owner' || u.gmailEnabled
                              ? u.gmailStatus
                                ? GMAIL_LABEL[u.gmailStatus]
                                : 'on, not connected'
                              : 'off'}
                          </span>
                          {u.role === 'member' && (u.status === 'active' || u.status === 'suspended') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => act(u, u.gmailEnabled ? 'disable_gmail' : 'enable_gmail')}
                              disabled={!!busy || (!u.gmailEnabled && !!gmailCap && gmailCap.used >= gmailCap.guard && !u.gmailStatus)}
                            >
                              {u.gmailEnabled ? 'Turn Gmail off' : 'Turn Gmail on'}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{when(u.lastLoginAt)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatUsd(u.spentTodayUsd)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatUsd(u.spent30dUsd)}</td>
                    <td className="py-2.5 text-right">
                      {u.role === 'member' && confirmDelete === u.id ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-2">
                          <span className="text-xs">Lock now and delete all its data in 30 days?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (await act(u, 'delete')) setConfirmDelete(null);
                            }}
                            disabled={!!busy}
                          >
                            Delete
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)} disabled={!!busy}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                      <span className="inline-flex gap-2 justify-end">
                      {u.role === 'member' && u.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => act(u, 'suspend')} disabled={!!busy}>
                          Suspend
                        </Button>
                      )}
                      {u.role === 'member' && u.status === 'suspended' && (
                        <Button size="sm" variant="outline" onClick={() => act(u, 'reactivate')} disabled={!!busy}>
                          Reactivate
                        </Button>
                      )}
                      {u.role === 'member' && u.status === 'deleting' && (
                        <>
                          <span className="self-center text-xs text-muted-foreground">
                            Deletes {u.deletionDueAt ? new Date(u.deletionDueAt).toLocaleDateString() : 'soon'}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => act(u, 'cancel_deletion')} disabled={!!busy}>
                            Cancel deletion
                          </Button>
                        </>
                      )}
                      {u.role === 'member' && (u.status === 'active' || u.status === 'suspended') && (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(u.id)} disabled={!!busy}>
                          Delete
                        </Button>
                      )}
                      </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}
