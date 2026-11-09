'use server';

import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { cancelOwnDeletion, normalizeEmail, requestOwnDeletion } from '@/lib/users';
import { sessionAccess, sessionUser } from '@/lib/user-id';

export type DeleteState = { error: string | null };

/** Schedule deletion of the signed-in member's account (30-day grace period)
 *  after they type their email to confirm, then sign them out. */
export async function deleteMyAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await sessionUser();
  if (!user) return { error: 'You are not signed in' };
  if (user.role !== 'member') return { error: 'The owner account cannot be deleted here' };
  const typed = normalizeEmail(String(form.get('confirm') ?? ''));
  if (typed !== normalizeEmail(user.email)) return { error: 'Type your email address exactly to confirm' };
  const error = await requestOwnDeletion(user.id);
  if (error) return { error };
  await signOut({ redirectTo: '/' }); // throws a redirect
  return { error: null };
}

/** From /access: cancel a deletion the member requested themselves. */
export async function cancelMyDeletion(): Promise<void> {
  const access = await sessionAccess();
  if (!access) redirect('/');
  const error = await cancelOwnDeletion(access.id);
  if (error) redirect(`/access?error=${encodeURIComponent(error)}`);
  redirect('/');
}
