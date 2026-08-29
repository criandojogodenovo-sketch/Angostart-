'use client';

/**
 * AngoStart — Catálogo completo com filtro por tipo + pesquisa global.
 * Grid responsivo (1 → 2 → 3 → 4 colunas).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Flame, Loader2, PackageSearch, RotateCcw, SearchX } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import ProductIcon from '@/components/ProductIcon';
import { useSearch } from '@/context/StoreContext';
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_ORDER,
  type Product,
  type ProductType,
} from '@/lib/products-data';
import { Button } from '@/components/ui/button';

type Filter = 'todos' | ProductType;

export default function CatalogClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { query } = useSearch();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'neon' | 'fallback'>('neon');
  const [filter, setFilter] = useState<Filter>('todos');
  const [hotOnly, setHotOnly] = useState(false);
  const initialized = useRef(false);

  // Filtro inicial vindo do URL (?tipo=...)
  useEffect(() => {
    const param = searchParams.get('tipo');
    if (param && (PRODUCT_TYPE_ORDER as string[]).includes(param)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com navegação por URL
      setFilter(param as Filter);
    }
    initialized.current = true;
  }, [searchParams]);

  // Carrega o catálogo REAL do Neon (Fase 4: sem produtos de exemplo)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/products', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { products?: Product[]; source?: 'neon' | 'fallback' }) => {
        if (cancelled) return;
        setProducts(data.products ?? []);
        if (data.source) setSource(data.source);
      })
      .catch(() => {
        if (!cancelled) setSource('fallback');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function changeFilter(next: Filter) {
    setFilter(next);
    router.replace(next === 'todos' ? '/produtos' : `/produtos?tipo=${next}`, {
      scroll: false,
    });
  }

  // Pesquisa global (navbar) aplicada sobre o resultado
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = products;
    if (hotOnly) list = list.filter((p) => p.is_hot);
    if (filter !== 'todos') list = list.filter((p) => p.type === filter);
    if (needle) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.description.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [products, filter, query, hotOnly]);

  const filters: { key: Filter; label: string; icon: string }[] = [
    { key: 'todos', label: 'Todos', icon: 'package' },
    ...PRODUCT_TYPE_ORDER.map((t) => ({
      key: t as Filter,
      label: PRODUCT_TYPES[t].label,
      icon: PRODUCT_TYPES[t].icon,
    })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Cabeçalho + pesquisa ativa */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Catálogo AngoStart
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Infoprodutos, produtos físicos e serviços — tudo em Kwanzas, com
          entrega em Luanda.
        </p>
        {query.trim() && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm text-emerald-700">
            A filtrar por: <strong>“{query.trim()}”</strong>
          </p>
        )}
      </div>

      {/* Filtros por tipo */}
      <div
        className="mb-8 flex flex-wrap items-center gap-2 overflow-x-auto pb-2"
        role="group"
        aria-label="Filtrar por tipo"
      >
        {filters.map(({ key, label, icon }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => changeFilter(key)}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-600'
              }`}
            >
              <ProductIcon name={icon} className="h-4 w-4" />
              {label}
            </button>
          );
        })}
        {/* Hot badge — produtos "em alta" escolhidos pelos vendedores */}
        <button
          onClick={() => setHotOnly((v) => !v)}
          aria-pressed={hotOnly}
          className={`ml-auto flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
            hotOnly
              ? 'border-orange-500 bg-orange-500 text-white shadow-md shadow-orange-500/25'
              : 'border-orange-200 bg-white text-orange-600 hover:border-orange-400 hover:bg-orange-50'
          }`}
        >
          <Flame className="h-4 w-4" aria-hidden="true" />
          Em alta
        </button>
      </div>

      {/* Estados */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm">A carregar o catálogo do Neon…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            {query.trim() || filter !== 'todos' || hotOnly ? (
              <SearchX className="h-8 w-8 text-slate-400" />
            ) : (
              <PackageSearch className="h-8 w-8 text-slate-400" />
            )}
          </span>
          {products.length === 0 && !query.trim() && filter === 'todos' && !hotOnly ? (
            <>
              <p className="font-medium text-slate-700">Catálogo em atualização</p>
              <p className="max-w-sm text-sm text-slate-500">
                Ainda não há produtos publicados — os vendedores AngoStart estão
                a preparar novidades. Volta em breve!
              </p>
              <Button
                asChild
                className="mt-2 bg-emerald-500 text-white hover:bg-emerald-600"
              >
                <Link href="/perfil">Quero vender na AngoStart</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-700">Nada encontrado</p>
              <p className="max-w-sm text-sm text-slate-500">
                Não há produtos para esta pesquisa ou filtro. Tenta limpar os
                filtros ou procurar por outro termo.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  changeFilter('todos');
                  setHotOnly(false);
                }}
                className="mt-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Limpar filtros
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-400" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'resultado' : 'resultados'}
            {source === 'fallback' && ' (catálogo temporariamente indisponível)'}
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
