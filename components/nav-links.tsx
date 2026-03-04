'use client';

import { Microscope, Newspaper } from 'lucide-react';
import { useSection } from '@/context/section-context';

const links = [
  { id: 'research', label: 'Deep Research', icon: Microscope },
  { id: 'news',     label: 'News Hub',      icon: Newspaper  },
] as const;

export function NavLinks() {
  const { section, setSection } = useSection();
  return (
    <div className="flex items-center bg-muted/50 rounded-full p-1 border border-border/50 gap-0.5">
      {links.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setSection(id)}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
            section === id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
