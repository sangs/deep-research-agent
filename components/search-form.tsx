import { FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function SearchForm({ query, onQueryChange, onSubmit, isLoading }: SearchFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="What would you like to research?"
        className="flex-1"
        disabled={isLoading}
      />
      <Button type="submit" disabled={!query.trim() || isLoading}>
        {isLoading ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Researching…
          </span>
        ) : (
          'Research'
        )}
      </Button>
    </form>
  );
}
