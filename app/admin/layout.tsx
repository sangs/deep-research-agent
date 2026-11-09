import { redirect } from 'next/navigation';
import { isOwner, sessionUser } from '@/lib/user-id';

// The owner console is owner-only: anyone else goes back to the app before the
// page renders. /api/admin/users enforces the same check for every request.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await sessionUser())) redirect('/');
  return children;
}
