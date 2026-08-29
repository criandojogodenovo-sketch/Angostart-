'use client';

/**
 * AngoStart — Barra de pesquisa global.
 * Escrever filtra o catálogo em tempo real (contexto global);
 * se o utilizador não estiver em /produtos, é redirecionado para lá.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useSearch } from '@/context/StoreContext';

export default function SearchBar({
  className = '',
  placeholder = 'Procurar produtos e serviços…',
  onSearched,
}: {
  className?: string;
  placeholder?: string;
  onSearched?: () => void;
}) {
  const { query, setQuery } = useSearch();
  const [value, setValue] = useState(query);
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza quando a pesquisa global muda a partir de outro sítio
  useEffect(() => {
    setValue(query);
  }, [query]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    setQuery(next);

    if (pathname !== '/produtos') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.push('/produtos');
        onSearched?.();
      }, 450);
    }
  }

  function handleClear() {
    setValue('');
    setQuery('');
  }

  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (pathname !== '/produtos') router.push('/produtos');
        onSearched?.();
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Procurar produtos e serviços"
        className="h-10 w-full rounded-full border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Limpar pesquisa"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}
