'use client';

/**
 * AngoStart — Pesquisa de prestadores de serviços (/prestadores).
 *
 * Pesquisa por nome, especialidade e cidade (ILIKE no PostgreSQL), com
 * filtros por tipo de serviço (domicílio/remoto) e ordenação por
 * reputação. Cada cartão liga ao portfólio público do prestador
 * (/portfolio/[username]) e ao CTA de contacto WhatsApp.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bike,
  Globe,
  Loader2,
  MapPin,
  Package,
  Search,
  SearchX,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CIDADES_ANGOLA } from '@/lib/cidades-angola';
import { ROLE_LABELS } from '@/lib/roles';

interface Prestador {
  id: number;
  name: string;
  username: string | null;
  role: string;
  cidade: string | null;
  especialidade: string | null;
  bio: string | null;
  portfolio_image: string | null;
  ai_rating: number | null;
  ai_summary: string | null;
  produtos: number;
  media_avaliacoes: number | null;
  total_avaliacoes: number;
}

interface Categoria {
  value: string;
  label: string;
}

const CIDADES = Object.keys(CIDADES_ANGOLA).sort();

/** "luanda" → "Luanda" (rótulos das cidades no filtro). */
function cityLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

const TIPOS = [
  { value: '', label: 'Todos os serviços', icon: Wrench },
  { value: 'domicilio', label: 'Ao domicílio', icon: Bike },
  { value: 'remoto', label: 'Remoto', icon: Globe },
];

const ORDENACOES = [
  { value: 'rating', label: 'Melhor avaliação' },
  { value: 'nome', label: 'Nome (A–Z)' },
  { value: 'recentes', label: 'Mais recentes' },
];

export default function PrestadoresPage() {
  const [q, setQ] = useState('');
  const [cidade, setCidade] = useState('');
  const [tipo, setTipo] = useState('');
  const [categoria, setCategoria] = useState(''); // Fase 11
  const [ordenar, setOrdenar] = useState('rating');

  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]); // Fase 11
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (cidade) params.set('cidade', cidade);
      if (tipo) params.set('tipo', tipo);
      if (categoria) params.set('categoria', categoria); // Fase 11
      if (ordenar) params.set('ordenar', ordenar);

      const res = await fetch(`/api/prestadores?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        prestadores?: Prestador[];
        categorias?: Categoria[];
      };
      setPrestadores(data.prestadores ?? []);
      if (data.categorias?.length) setCategorias(data.categorias);
    } catch {
      setPrestadores([]);
    } finally {
      setSearched(true);
      setLoading(false);
    }
  }, [q, cidade, tipo, categoria, ordenar]);

  // Primeira carga + recarrega quando mudam os filtros estruturais
  useEffect(() => {
    load();
  }, [load]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    load();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Cabeçalho */}
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Prestadores de serviços
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Encontra profissionais verificados em toda Angola — serviços ao
          domicílio e trabalho remoto. Pesquisa por nome, especialidade ou
          cidade e vê a reputação real de cada prestador.
        </p>
      </div>

      {/* Pesquisa + filtros */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        aria-label="Pesquisar prestadores"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, especialidade ou cidade (ex.: electricista, Luanda…)"
              className="h-11 pl-9"
              aria-label="Pesquisar por nome, especialidade ou cidade"
            />
          </div>
          <select
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            aria-label="Filtrar por cidade"
            className="h-11 rounded-md border border-input bg-background px-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Todas as cidades</option>
            {CIDADES.map((slug) => (
              <option key={slug} value={slug}>
                {cityLabel(slug)}
              </option>
            ))}
          </select>
          <select
            value={ordenar}
            onChange={(e) => setOrdenar(e.target.value)}
            aria-label="Ordenar resultados"
            className="h-11 rounded-md border border-input bg-background px-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {ORDENACOES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            className="h-11 bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700"
          >
            <Search className="mr-2 h-4 w-4" /> Pesquisar
          </Button>
        </div>

        {/* Tipo de serviço */}
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo de serviço">
          {TIPOS.map(({ value, label, icon: Icon }) => {
            const active = tipo === value;
            return (
              <button
                key={value || 'todos'}
                type="button"
                onClick={() => setTipo(value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                  active
                    ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-500/25'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Fase 11 — filtro por categoria (Design, Programação, Marketing…) */}
        {categorias.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Categoria">
            <button
              type="button"
              onClick={() => setCategoria('')}
              aria-pressed={categoria === ''}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                categoria === ''
                  ? 'border-slate-900 bg-slate-900 text-white shadow'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700'
              }`}
            >
              Todas as categorias
            </button>
            {categorias.map((c) => {
              const active = categoria === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategoria(active ? '' : c.value)}
                  aria-pressed={active}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white shadow'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </form>

      {/* Resultados */}
      <div className="mt-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm">A procurar prestadores…</p>
          </div>
        ) : prestadores.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <SearchX className="h-8 w-8 text-slate-400" />
            </span>
            <p className="font-medium text-slate-700">
              {searched ? 'Nenhum prestador encontrado' : 'Ainda sem prestadores'}
            </p>
            <p className="max-w-md text-sm text-slate-500">
              {searched
                ? 'Tenta outra pesquisa, limpa os filtros ou escolhe uma cidade diferente.'
                : 'Os profissionais ainda estão a criar os seus portfólios — volta em breve.'}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-400" aria-live="polite">
              {prestadores.length}{' '}
              {prestadores.length === 1 ? 'prestador encontrado' : 'prestadores encontrados'}
            </p>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {prestadores.map((p) => {
                return (
                  <li
                    key={p.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                  >
                    {/* Cabeçalho do cartão */}
                    <div className="flex items-start gap-4 p-5 pb-4">
                      {p.portfolio_image ? (
                        <img
                          src={p.portfolio_image}
                          alt={`Foto de ${p.name}`}
                          className="h-14 w-14 shrink-0 rounded-xl object-cover shadow"
                        />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-xl font-bold text-white shadow">
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-base font-semibold text-slate-900">
                          {p.name}
                        </h2>
                        <p className="text-xs font-semibold text-blue-600">
                          {ROLE_LABELS[p.role] ?? p.role}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                          {p.cidade && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {p.cidade}
                            </span>
                          )}
                          {p.username && <span>@{p.username}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Reputação + especialidade */}
                    <div className="flex flex-wrap items-center gap-2 px-5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {p.media_avaliacoes !== null
                          ? p.media_avaliacoes.toFixed(1)
                          : 'Novo'}
                        {p.total_avaliacoes > 0 && (
                          <span className="font-normal text-amber-600">
                            ({p.total_avaliacoes})
                          </span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        <Package className="h-3 w-3" />
                        {p.produtos}{' '}
                        {p.produtos === 1 ? 'serviço/produto' : 'serviços/produtos'}
                      </span>
                      {/* 🤖 Fase 14: nota IA da qualidade do perfil (0-10) —
                          perfis claros e completos destacam-se primeiro. */}
                      {p.ai_rating !== null && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"
                          title={
                            p.ai_summary
                              ? `Análise IA: ${p.ai_summary}`
                              : 'Nota de qualidade do perfil atribuída por análise IA.'
                          }
                        >
                          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                          IA {p.ai_rating.toFixed(1)}
                        </span>
                      )}
                    </div>

                    {p.especialidade && (
                      <p className="mt-2 px-5 text-sm font-medium text-slate-700">
                        {p.especialidade}
                      </p>
                    )}
                    {p.bio && (
                      <p className="mt-1 line-clamp-2 px-5 text-sm text-slate-500">
                        {p.bio}
                      </p>
                    )}

                    {/* Ações — 🔒 Fase 6 (ponto 2): contacto apenas dentro da plataforma */}
                    <div className="mt-auto flex gap-2 p-5 pt-4">
                      <Button
                        asChild
                        className="h-10 flex-1 bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        <Link href={`/portfolio/${p.username ?? ''}`}>
                          Ver portfólio
                        </Link>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="mt-10">
        <Link
          href="/produtos"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" /> Explorar também o catálogo de produtos
        </Link>
      </div>
    </div>
  );
}
