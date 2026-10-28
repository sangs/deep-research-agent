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
  status: 'pending' | 'active' | 'suspended';
  createdAt: number;
  lastLoginAt: number | null;
  linked: boolean;
  spentTodayUsd: number;
  spent30dUsd: number;
}

type Action = 'approve' | 'reject' | 'suspend' | 'reactivate';

const STATUS_STYLE: Record<AdminUser['status'], string> = {
  pending: 'bg-[#fab219]/15 text-foreground border-[#fab219]/40',
  active: 'bg-[#0ca30c]/15 text-foreground border-[#0ca30c]/40',
  suspended: 'bg-muted text-muted-foreground border-border',
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

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? `Could not load users (HTTP ${res.status})`);
    setUsers(body.users);
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
                    <td className="py-2.5 pr-3 text-muted-foreground">{when(u.lastLoginAt)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatUsd(u.spentTodayUsd)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatUsd(u.spent30dUsd)}</td>
                    <td className="py-2.5 text-right">
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
