'use client';

/**
 * AngoStart — Diretório de Estabelecimentos (/estabelecimentos, Fase 16).
 *
 * Lista de espaços comerciais publicados pelos vendedores (lojas, hotéis,
 * oficinas, salões…) com filtros por categoria e cidade. Cada cartão liga
 * à página pública do estabelecimento (mini-loja com mapa fixo, fotos,
 * horário e produtos/serviços à venda).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Clock,
  Loader2,
  MapPin,
  SearchX,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CIDADES_ANGOLA } from '@/lib/cidades-angola';
import { BUSINESS_CATEGORIES, businessCategoryLabel, type BusinessProfile } from '@/lib/business';
import ShareButton from '@/components/ShareButton';

const CIDADES = Object.keys(CIDADES_ANGOLA).sort();

function cityLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default function EstabelecimentosPage() {
  const [categoria, setCategoria] = useState('all');
  const [cidade, setCidade] = useState('');
  const [items, setItems] = useState<BusinessProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoria !== 'all') params.set('categoria', categoria);
      if (cidade) params.set('cidade', cidade);
      params.set('limit', '60');
      const res = await fetch(`/api/estabelecimentos?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as { items?: BusinessProfile[] };
      if (res.ok && data.items) setItems(data.items);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, [categoria, cidade]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-24 pt-6">
      {/* Cabeçalho */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900">
            <Building2 className="h-6 w-6 text-teal-600" />
            Estabelecimentos
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-slate-600">
          Espaços comerciais na AngoStart — lojas, hotéis, oficinas e salões com
          localização fixa no mapa, horário e serviços à venda. Encontra perto de ti e
          compra com a segurança da plataforma.
        </p>
      </div>

      {/* Filtros */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoria('all')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              categoria === 'all'
                ? 'bg-teal-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todas
          </button>
          {BUSINESS_CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategoria(c.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                categoria === c.value
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MapPin className="h-4 w-4 text-slate-400" />
          <select
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            aria-label="Filtrar por cidade"
          >
            <option value="">Todas as cidades</option>
            {CIDADES.map((c) => (
              <option key={c} value={c}>
                {cityLabel(c)}
              </option>
            ))}
          </select>
          <Input
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            placeholder="Ou escreve a cidade…"
            className="h-10 max-w-48"
            aria-label="Cidade"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-teal-600" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <SearchX className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="font-semibold text-slate-700">Nenhum estabelecimento encontrado</p>
          <p className="mt-1 text-sm text-slate-500">
            Ajusta os filtros ou volta mais tarde — novos espaços chegam todos os dias.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b) => (
            <div
              key={b.id}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              {/* Partilha pública — URL limpo do estabelecimento, para qualquer visitante */}
              <ShareButton
                productUrl={`/estabelecimentos/${b.id}`}
                compact
                className="absolute right-2 top-2 z-10"
              />
              <Link href={`/estabelecimentos/${b.id}`} className="block">
                <div className="relative h-36 overflow-hidden bg-gradient-to-br from-blue-600/10 via-slate-100 to-teal-600/10">
                  {b.fotos && b.fotos.length > 0 ? (
                    <img
                      src={b.fotos[0]}
                      alt={b.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : b.logo_url ? (
                    <img
                      src={b.logo_url}
                      alt={b.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <Building2 className="h-10 w-10 text-slate-300" />
                    </span>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-teal-700 shadow-sm">
                    {businessCategoryLabel(b.category)}
                  </span>
                </div>
                <div className="p-4">
                  <h2 className="truncate text-base font-bold text-slate-900">{b.name}</h2>
                  {b.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{b.description}</p>
                  )}
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    {(b.address || b.cidade) && (
                      <p className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-teal-600" />
                        {b.address ?? cityLabel(b.cidade as string)}
                      </p>
                    )}
                    {b.horario && (
                      <p className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-blue-500" /> {b.horario}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
