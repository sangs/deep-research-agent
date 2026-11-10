import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { cancelMyDeletion } from '@/app/account/actions';
import { DELETION_GRACE_DAYS, deletionDueAt } from '@/lib/users';
import { sessionAccess } from '@/lib/user-id';

// Where pending, suspended and scheduled-for-deletion accounts land (auth.ts `authorized` sends them here).
export const metadata: Metadata = { title: 'Access — Research Suite' };

const COPY = {
  pending: {
    title: 'Your access request is waiting for approval',
    body: 'This app is private and the owner approves each account. You signed in successfully and your request has been recorded. Once it is approved, reload this page to start. Your workspace will be private to you.',
  },
  suspended: {
    title: 'Your access is suspended',
    body: 'The owner has suspended this account. Your data has been kept. Contact the owner if you think this is a mistake.',
  },
  deleting: {
    title: 'Your account is scheduled for deletion',
    body: `The account is locked and everything stored for it will be permanently deleted ${DELETION_GRACE_DAYS} days after the request.`,
  },
} as const;

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const access = await sessionAccess();
  if (!access) redirect('/api/auth/signin');
  // An active account normally never reaches this page (the gate sends it to /).
  // It can for a few seconds after an approval or a cancelled deletion, while the
  // gate's status cache catches up: show a link instead of redirecting, which
  // would bounce between / and /access until then.
  if (access.status === 'active') {
    return (
      <main className="container mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
          <h1 className="text-xl font-semibold">You&apos;re all set</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your account is active. If the app sends you back here, wait a few seconds and try again.
          </p>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Continue to the app
          </Link>
        </div>
      </main>
    );
  }
  const copy = COPY[access.status];
  const { error } = await searchParams;
  const selfRequested = access.status === 'deleting' && access.deletionRequestedBy === access.id;
  return (
    <main className="container mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{copy.body}</p>
        {access.status === 'deleting' && access.deletionRequestedAt && (
          <div className="space-y-3 text-sm">
            <p>
              Deletion date: <span className="font-medium">{formatDay(deletionDueAt(access.deletionRequestedAt))}</span> (UTC).
            </p>
            {selfRequested ? (
              <form action={cancelMyDeletion}>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Cancel deletion and keep my account
                </button>
              </form>
            ) : (
              <p className="text-muted-foreground">The owner scheduled this deletion. Contact the owner to keep the account.</p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[#d03b3b]">
            {error}
          </p>
        )}
        <p className="text-sm">
          Signed in as <span className="font-medium">{access.email}</span>
        </p>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button type="submit" className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
