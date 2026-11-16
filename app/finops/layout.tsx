import { notFound } from 'next/navigation';
import { isOwner, sessionUser } from '@/lib/user-id';

// /finops is owner-only. Anyone else gets a 404 (not a redirect), so the page's existence isn't revealed.
// /api/finops/summary and the backend enforce the same check.
export const metadata = { title: 'FinOps · costs' };

export default async function FinopsLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await sessionUser())) notFound();
  return children;
}
