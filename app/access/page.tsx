import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { sessionAccess } from '@/lib/user-id';

// Where pending and suspended accounts land (auth.ts `authorized` sends them here).
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
} as const;

export default async function AccessPage() {
  const access = await sessionAccess();
  if (!access) redirect('/api/auth/signin');
  if (access.status === 'active') redirect('/');
  const copy = COPY[access.status];
  return (
    <main className="container mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{copy.body}</p>
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
