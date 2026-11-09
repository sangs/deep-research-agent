'use client';
import { createContext, useContext } from 'react';

// The signed-in user's role, provided by app/layout.tsx from the server session.
// UI hint only: every owner-only API checks the role server-side.
type Account = { isOwner: boolean };

const AccountContext = createContext<Account>({ isOwner: false });

export function AccountProvider({ isOwner, children }: { isOwner: boolean; children: React.ReactNode }) {
  return <AccountContext.Provider value={{ isOwner }}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
