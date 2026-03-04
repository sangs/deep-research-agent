'use client';

import { useSection } from '@/context/section-context';

const links = [
  { id: 'research', label: 'Deep Research' },
  { id: 'news',     label: 'News Hub'      },
] as const;

export function NavLinks() {
  const { section, setSection } = useSection();
  return (
    <>
      {links.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => setSection(id)}
          className={section === id
            ? 'bg-muted text-foreground font-medium rounded-md px-2.5 py-1'
            : 'text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1'}
        >
          {label}
        </button>
      ))}
    </>
  );
}
