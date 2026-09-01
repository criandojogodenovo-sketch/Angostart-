import Link from 'next/link';
import { sql } from '@/lib/db';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Search, MapPin, Package, Sparkles } from 'lucide-react';
import { CIDADES_ANGOLA } from '@/lib/cidades-angola';

export const dynamic = 'force-dynamic';

/**
 * /lojas — diretório de lojas virtuais (Fase 9).
 * Fase 11: pesquisa por nome/categoria/cidade + filtro "com produtos".
 *  - q         → nome da loja, descrição ou dono (ILIKE)
 *  - categoria → especialidade do dono (ILIKE parcial)
 *  - cidade    → cidade do dono (ILIKE)
 *  - produtos=1 (padrão) → apenas lojas com produtos publicados
 * Implementado como server component com form GET (sem JS obrigatório).
 */

/* Fase 11 — categorias (termos-raiz, igual à pesquisa de prestadores) */
const CATEGORIAS: { value: string; label: string; terms: string[] }[] = [
  { value: 'design', label: 'Design', terms: ['design', 'designer', 'gráfico', 'grafico'] },
  { value: 'programacao', label: 'Programação', terms: ['programa', 'desenvolvedor', 'developer', 'software', 'web', 'informática', 'informatica'] },
  { value: 'marketing', label: 'Marketing', terms: ['marketing', 'social media', 'seo', 'publicidade', 'divulga'] },
  { value: 'electricidade', label: 'Electricidade', terms: ['electric', 'eletric'] },
  { value: 'canalizacao', label: 'Canalização', terms: ['canaliz'] },
  { value: 'beleza', label: 'Beleza', terms: ['beleza', 'cabele', 'barber', 'barbeiro', 'manicure', 'unhas'] },
  { value: 'fotografia', label: 'Fotografia', terms: ['foto', 'vídeo', 'video', 'filmag'] },
  { value: 'educacao', label: 'Educação', terms: ['educ', 'professor', 'explicador', 'aula', 'tutor', 'formação', 'formacao'] },
  { value: 'traducao', label: 'Tradução', terms: ['tradu', 'tradutor', 'línguas', 'linguas'] },
  { value: 'reparacoes', label: 'Reparações', terms: ['repara', 'consert', 'técnico', 'tecnico', 'instala'] },
  { value: 'mecanica', label: 'Mecânica', terms: ['mecânic', 'mecanic', 'auto'] },
  { value: 'costura', label: 'Costura', terms: ['costur', 'alfaiat'] },
];

const CIDADES = Object.keys(CIDADES_ANGOLA).sort();

function cityLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

interface LojasFilters {
  q: string;
  categoria: string;
  cidade: string;
  produtos: string;
}

export default async function LojasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
  /* last-wins: checkbox + hidden input 0 → quando marcado chega ['0','1'] */
  const last = (v: string | string[] | undefined) =>
    Array.isArray(v) ? (v[v.length - 1] ?? '') : (v ?? '');
  const filters: LojasFilters = {
    q: first(sp.q).trim().slice(0, 80),
    categoria: first(sp.categoria).trim().slice(0, 40),
    cidade: first(sp.cidade).trim().slice(0, 60),
    /* Padrão (primeira visita sem params): apenas lojas com produtos */
    produtos: sp.produtos === undefined ? '1' : last(sp.produtos),
  };

  const cat = CATEGORIAS.find((c) => c.value === filters.categoria.toLowerCase());
  const catTerms = cat ? cat.terms.map((t) => `%${t}%`) : null;
  const like = filters.q ? `%${filters.q}%` : null;
  const cidadeValida =
    filters.cidade && CIDADES.includes(filters.cidade.toLowerCase())
      ? filters.cidade.toLowerCase()
      : null;
  const onlyWithProducts = filters.produtos === '1';

  let stores: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    owner_name: string;
    verified: boolean;
    ai_rating: number | null;
    product_count: number;
    follower_count: number;
  }[] = [];

  try {
    stores = (await sql`
      SELECT s.id, s.name, s.slug, s.description, s.logo_url,
             u.name AS owner_name, u.is_verified_bi::boolean AS verified,
             u.ai_seller_rating::float8 AS ai_rating,
             (SELECT COUNT(*)::int FROM products p WHERE p.user_id = s.owner_id) AS product_count,
             (SELECT COUNT(*)::int FROM store_followers f WHERE f.store_id = s.id) AS follower_count
      FROM stores s
      JOIN users u ON u.id = s.owner_id
      WHERE u.blocked = FALSE
        AND (${like}::text IS NULL
             OR s.name ILIKE ${like}
             OR s.description ILIKE ${like}
             OR u.name ILIKE ${like})
        AND (
          ${catTerms === null}::boolean
          OR u.especialidade ILIKE ANY(${catTerms ? catTerms : []}::text[])
          OR u.bio ILIKE ANY(${catTerms ? catTerms : []}::text[])
        )
        AND (${cidadeValida}::text IS NULL OR u.cidade ILIKE ${cidadeValida})
        AND (${onlyWithProducts}::boolean = FALSE
             OR (SELECT COUNT(*) FROM products p2 WHERE p2.user_id = s.owner_id) > 0)
      ORDER BY u.ai_seller_rating DESC NULLS LAST, product_count DESC, s.created_at DESC
      LIMIT 100
    `) as unknown as typeof stores;
  } catch {
    stores = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">Lojas virtuais</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cada vendedor AngoStart tem a sua própria loja — explora, segue e compra com confiança.
      </p>

      {/* ── Fase 11: pesquisa + filtros (form GET, funciona sem JS) ── */}
      <form
        method="GET"
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        aria-label="Pesquisar lojas"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Nome da loja, descrição ou vendedor…"
              aria-label="Pesquisar por nome da loja, descrição ou vendedor"
              className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
          <select
            name="categoria"
            defaultValue={filters.categoria}
            aria-label="Filtrar por categoria"
            className="h-11 rounded-md border border-input bg-background px-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Todas as categorias</option>
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            name="cidade"
            defaultValue={filters.cidade}
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
          <button
            type="submit"
            className="h-11 rounded-md bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Search className="mr-2 inline h-4 w-4" /> Pesquisar
          </button>
        </div>

        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          {/* hidden "0" + checkbox "1": desmarcado envia 0, marcado envia 0 e 1 (último ganha) */}
          <input type="hidden" name="produtos" value="0" />
          <input
            type="checkbox"
            name="produtos"
            value="1"
            defaultChecked={onlyWithProducts}
            className="h-4 w-4 accent-blue-500"
          />
          <Package className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Mostrar apenas lojas com produtos publicados
        </label>
      </form>

      {/* ── Resultados ── */}
      {stores.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-400">
          Nenhuma loja encontrada — tenta limpar os filtros ou volta em breve!
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-400" aria-live="polite">
            {stores.length} {stores.length === 1 ? 'loja encontrada' : 'lojas encontradas'}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((s) => (
              <Link
                key={s.id}
                href={`/loja/${s.slug}`}
                className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <div
                  className="h-24 bg-gradient-to-r from-blue-600 to-teal-600"
                  style={s.logo_url ? { backgroundImage: `url(${s.logo_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                />
                <div className="p-4">
                  <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    {s.name}
                    {s.verified && <VerifiedBadge size={14} />}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">Por {s.owner_name}</p>
                  {s.ai_rating !== null && (
                    <p
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700"
                      title="Nota de qualidade do perfil atribuída por análise IA."
                    >
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" /> IA {s.ai_rating.toFixed(1)}
                    </p>
                  )}
                  {s.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{s.description}</p>
                  )}
                  <p className="mt-3 text-xs font-semibold text-blue-700">
                    {s.product_count} produto(s) · {s.follower_count} seguidor(es)
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mt-10">
        <Link
          href="/prestadores"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
        >
          <MapPin className="h-4 w-4" /> Explorar também os prestadores de serviços
        </Link>
      </div>
    </main>
  );
}
