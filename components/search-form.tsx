import { FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Sparkles } from 'lucide-react';

interface SearchFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function SearchForm({ query, onQueryChange, onSubmit, isLoading }: SearchFormProps) {
  return (
    <form onSubmit={onSubmit} className="relative group">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="What would you like to research?"
        className="pl-12 pr-36 h-14 text-base rounded-xl bg-card border-border/80 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
        disabled={isLoading}
      />
      <Button
        type="submit"
        disabled={!query.trim() || isLoading}
        className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-5 rounded-lg gap-2"
      >
        {isLoading ? (
          <>
            <span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
            Researching…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            Research
          </>
        )}
      </Button>
    </form>
  );
}
