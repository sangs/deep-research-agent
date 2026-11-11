import { Mail } from 'lucide-react';
import { gmailAccess } from '@/lib/mailboxes';
import { ConnectGmailLink } from '@/components/gmail-connect-card';
import { disconnectMyGmail, setMyGmailSweep } from './actions';

const ERRORS: Record<string, string> = {
  cancelled: 'Connecting was cancelled on Google’s screen.',
  bad_state: 'The connect link expired or was opened in another browser. Try again.',
  scope_missing: 'Gmail access wasn’t granted. Try again and tick the Gmail box on Google’s screen.',
  wrong_account: 'That was a different Google account. Connect the one you sign in with.',
  not_enabled: 'Gmail is not turned on for your account. Ask the owner.',
  cap_reached: 'The app has reached its limit of Gmail connections. Ask the owner.',
  no_refresh_token: 'Google didn’t return lasting access. Try again.',
  disconnect_failed: 'Disconnecting failed. Try again in a minute.',
};

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

/** /account → Gmail (design 15 §9). Server component; reads the user's own mailbox row. */
export async function GmailSection({ userId, notice, error }: { userId: string; notice?: string; error?: string }) {
  const { allowed, mailbox } = await gmailAccess(userId);
  if (!allowed && !mailbox) return null;
  const connected = mailbox && mailbox.status !== 'disconnected';
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">Gmail</h2>
      {notice === 'connected' && <p className="text-sm text-[#2f9e58]">Gmail connected.</p>}
      {notice === 'disconnected' && (
        <p className="text-sm text-muted-foreground">
          Gmail disconnected: access removed at Google; stored access and email summaries deleted. Saved digests are kept.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[#d03b3b]">
          {ERRORS[error] ?? 'Connecting Gmail failed. Try again.'}
        </p>
      )}
      {!connected ? (
        <>
          <p className="text-sm text-muted-foreground">
            Not connected. Connect the Gmail of the Google account you sign in with to use the Newsletter tab. The app
            reads newsletters from your senders, labels or moves emails only when you ask, and never deletes, trashes or
            sends email.
          </p>
          {allowed && (
            <ConnectGmailLink className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted transition-colors">
              <Mail className="h-4 w-4" /> Connect Gmail
            </ConnectGmailLink>
          )}
        </>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Connected</dt>
              <dd className="font-medium">{mailbox.email}</dd>
              <dd className="text-xs text-muted-foreground">since {fmt(mailbox.connectedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last background check</dt>
              <dd className="font-medium">{fmt(mailbox.lastSweepAt)}</dd>
              {mailbox.lastError && <dd className="text-xs text-[#d03b3b]">{mailbox.lastError}</dd>}
            </div>
          </dl>
          {mailbox.status === 'reauth_required' && (
            <p role="alert" className="text-sm text-[#d03b3b]">
              Google no longer accepts the app&apos;s access.{' '}
              <ConnectGmailLink className="underline underline-offset-2">Reconnect Gmail</ConnectGmailLink>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Background summarizing {mailbox.sweepEnabled ? 'is on' : 'is paused'}: every 30 minutes the app summarizes new
            mail from your newsletter senders so digests open fast. It counts toward your daily budget, at most $0.50 a day.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={setMyGmailSweep}>
              <input type="hidden" name="enabled" value={mailbox.sweepEnabled ? 'false' : 'true'} />
              <button className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted transition-colors">
                {mailbox.sweepEnabled ? 'Pause background summarizing' : 'Resume background summarizing'}
              </button>
            </form>
            <form action={disconnectMyGmail}>
              <button className="inline-flex h-9 items-center rounded-md border border-[#d03b3b]/50 px-3 text-sm text-[#d03b3b] hover:bg-[#d03b3b]/10 transition-colors">
                Disconnect Gmail
              </button>
            </form>
          </div>
          <p className="text-xs text-muted-foreground">
            Disconnecting removes the app&apos;s access at Google and deletes the stored access, your email summaries and
            organize history. Saved digests stay until you delete them or your account. You can also remove access at
            myaccount.google.com/permissions.
          </p>
        </>
      )}
    </section>
  );
}
