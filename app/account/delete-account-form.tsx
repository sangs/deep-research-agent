'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteMyAccount, type DeleteState } from './actions';

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteMyAccount, { error: null });
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="confirm" className="block text-sm">
        Type <span className="font-medium">{email}</span> to confirm
      </label>
      <Input
        id="confirm"
        name="confirm"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="sm:max-w-sm"
      />
      {state.error && (
        <p role="alert" className="text-sm text-[#d03b3b]">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="destructive" disabled={!matches || pending}>
        {pending ? 'Deleting…' : 'Delete my account'}
      </Button>
    </form>
  );
}
