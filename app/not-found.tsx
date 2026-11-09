import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

// Shown inside the root layout for any URL without a page — typically a
// mistyped or badly pasted address (e.g. a raw Markdown link). Signed-out
// visitors never see it: proxy.ts sends them to sign-in first.
export const metadata: Metadata = { title: 'Page not found — Research Suite' };

export default function NotFound() {
  return (
    <main className="container mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold">This page doesn&apos;t exist</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The address may be mistyped, or extra characters were included when it was copied. Check the address bar,
          or go back to the start.
        </p>
        <Link href="/" className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}>
          <ArrowLeft className="h-4 w-4" />
          Go to Research
        </Link>
      </div>
    </main>
  );
}
