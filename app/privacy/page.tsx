import type { Metadata } from 'next';

// Public page (no sign-in): Google's OAuth consent screen requires a privacy
// policy link on the app's authorized domain. Allowed in auth.ts `authorized`.
export const metadata: Metadata = {
  title: 'Privacy Policy — Research Suite',
};

const UPDATED = '2026-10-27';
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? 'the app owner';

export default function PrivacyPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 space-y-6 text-sm leading-relaxed">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="text-muted-foreground">Research Suite · last updated {UPDATED}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Who this app is for</h2>
        <p>
          Research Suite is a personal app run by its owner for their own use and a small number of people they allow. It is not
          offered to the public. Signing in requires a Google account on the owner&apos;s allowlist.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">What data it uses</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Google sign-in:</strong> your email address and name, only to check that you are allowed in and to keep you
            signed in (a session cookie).
          </li>
          <li>
            <strong>Gmail (the owner&apos;s inbox only):</strong> with the owner&apos;s permission (scope <code>gmail.modify</code>), the
            app reads newsletter emails from senders the owner configured, to build newsletter digests. It adds the label
            &ldquo;gmail-ai-digested&rdquo; to emails it has included, and labels or moves emails into folders only when the owner asks
            and can undo it. It never deletes, trashes or sends email.
          </li>
          <li>
            <strong>What you type:</strong> research and news questions, and the results generated for them.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Where data goes</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>AI processing:</strong> email text and questions are sent to OpenRouter (an AI model provider) to generate
            summaries and answers. Search queries are sent to Exa (a web search provider).
          </li>
          <li>
            <strong>Storage:</strong> email summaries (sender, subject, date, preview, links, summary), saved digests, research
            sessions and usage costs are stored in a Supabase (PostgreSQL) database. The app runs on Vercel and Google Cloud;
            credentials are kept in Google Cloud Secret Manager.
          </li>
          <li>Data is not sold, not used for advertising, and not shared with anyone else.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Google user data</h2>
        <p>
          The app&apos;s use and transfer of information received from Google APIs adheres to the{' '}
          <a
            className="underline underline-offset-2"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Gmail data is used only to provide the app&apos;s digest and organizing
          features to the owner.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">How long data is kept</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Per-email summaries: deleted 90 days after they are made.</li>
          <li>News results: reused for 1 hour, kept until removed. Saved newsletter digests: until the owner removes them.</li>
          <li>Research sessions: until deleted from the History drawer.</li>
        </ul>
        <p>
          The owner can withdraw the app&apos;s Gmail access at any time at{' '}
          <a className="underline underline-offset-2" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Contact</h2>
        <p>Questions about this policy: {CONTACT}.</p>
      </section>
    </main>
  );
}
