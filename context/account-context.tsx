'use client';
import { createContext, useContext } from 'react';

// The signed-in user's role and Gmail state, provided by app/layout.tsx from the
// server session. UI hint only: every API checks server-side.
export type GmailState = {
  /** The owner, or a member the owner turned Gmail on for (design 15, D2). */
  allowed: boolean;
  /** 'none' = never connected or disconnected. */
  status: 'none' | 'active' | 'reauth_required';
  email: string | null;
};
type Account = { isOwner: boolean; gmail: GmailState };

const NO_GMAIL: GmailState = { allowed: false, status: 'none', email: null };
const AccountContext = createContext<Account>({ isOwner: false, gmail: NO_GMAIL });

export function AccountProvider({
  isOwner,
  gmail = NO_GMAIL,
  children,
}: {
  isOwner: boolean;
  gmail?: GmailState;
  children: React.ReactNode;
}) {
  return <AccountContext.Provider value={{ isOwner, gmail }}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
