'use client';

import Link from 'next/link';
import { Mail, AlertCircle } from 'lucide-react';
import { useAccount } from '@/context/account-context';

/** Newsletter tab before Gmail is connected, or after Google refused the stored
 *  access (design 15 §9). Connecting is a separate consent from sign-in. */
export function GmailConnectCard() {
  const { gmail } = useAccount();
  const reconnect = gmail.status === 'reauth_required';
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg space-y-4 rounded-xl border border-border/60 bg-card p-6">
        <div className="flex items-center gap-2">
          {reconnect ? <AlertCircle className="h-5 w-5 text-[#d03b3b]" /> : <Mail className="h-5 w-5 text-primary" />}
          <h2 className="text-base font-semibold">{reconnect ? 'Reconnect your Gmail' : 'Connect your Gmail'}</h2>
        </div>
        {reconnect ? (
          <p className="text-sm text-muted-foreground">
            Google no longer accepts the app&apos;s access to {gmail.email ?? 'your Gmail'} (it was removed at Google, or
            your password changed). Background summarizing is paused until you reconnect.
          </p>
        ) : (
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
            <li>
              The app reads newsletter emails from the senders you list in Manage Sources and summarizes them into
              digests that only you can see.
            </li>
            <li>It labels or moves emails into folders only when you ask, and you can undo it.</li>
            <li>It never deletes, trashes or sends email.</li>
            <li>Use the same Google account you sign in with.</li>
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Google will show a &ldquo;Google hasn&apos;t verified this app&rdquo; screen. It&apos;s expected for this
          private app: choose <span className="font-medium">Advanced → Go to the app</span>, then tick the Gmail box.
          You can disconnect at any time on the Account page. See the{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>
          .
        </p>
        <a
          href="/api/gmail/connect"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Mail className="h-4 w-4" /> {reconnect ? 'Reconnect Gmail' : 'Connect Gmail'}
        </a>
      </div>
    </div>
  );
}
