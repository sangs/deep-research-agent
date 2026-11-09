'use server';

import { signOut } from '@/auth';
import { deleteOwnAccount, normalizeEmail } from '@/lib/users';
import { sessionUser } from '@/lib/user-id';

export type DeleteState = { error: string | null };

/** Delete the signed-in member's account after they type their email to confirm. */
export async function deleteMyAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await sessionUser();
  if (!user) return { error: 'You are not signed in' };
  if (user.role !== 'member') return { error: 'The owner account cannot be deleted here' };
  const typed = normalizeEmail(String(form.get('confirm') ?? ''));
  if (typed !== normalizeEmail(user.email)) return { error: 'Type your email address exactly to confirm' };
  const error = await deleteOwnAccount(user.id);
  if (error) return { error };
  await signOut({ redirectTo: '/' }); // throws a redirect
  return { error: null };
}
