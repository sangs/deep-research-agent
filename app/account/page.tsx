import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { sessionUser } from '@/lib/user-id';
import { DeleteAccountForm } from './delete-account-form';

export const metadata: Metadata = { title: 'Account — Research Suite' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AccountPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  const isMember = user.role === 'member';
  return (
    <main className="container mx-auto max-w-2xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Account</h1>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>. Your research, digests and
        sources are private to you; no other account, including the owner&apos;s, can read them.
      </p>

      <Section title="Export your data">
        <p className="text-sm text-muted-foreground">
          One JSON file with your research sessions, digests (saved and cached), source lists, usage and budget raises.
        </p>
        <a
          href="/api/account/export"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted transition-colors"
        >
          <Download className="h-4 w-4" /> Download my data
        </a>
      </Section>

      <Section title="Delete your account">
        {isMember ? (
          <>
            <p className="text-sm text-muted-foreground">
              This permanently deletes your account and everything stored for it: research history, digests, sources,
              usage and budget history. It can&apos;t be undone. Export your data first if you want a copy. You can request
              access again later as a new account.
            </p>
            <DeleteAccountForm email={user.email} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The owner account can&apos;t be deleted from the app.
          </p>
        )}
      </Section>
    </main>
  );
}
