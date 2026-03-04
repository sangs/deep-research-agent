'use client';
import { createContext, useContext, useState } from 'react';

type Section = 'research' | 'news';
type SectionCtx = { section: Section; setSection: (s: Section) => void };

const SectionContext = createContext<SectionCtx>({ section: 'research', setSection: () => {} });

export function SectionProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<Section>('research');
  return <SectionContext.Provider value={{ section, setSection }}>{children}</SectionContext.Provider>;
}

export const useSection = () => useContext(SectionContext);
