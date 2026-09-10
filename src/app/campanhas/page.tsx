import Link from 'next/link';
import { sql } from '@/lib/db';
import { Search, Megaphone, Ticket, CheckCircle2, CalendarClock } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import PatternWaves from '@/components/illustrations/PatternWaves';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — /campanhas — descoberta pública de campanhas e oportunidades
 * (evolução preservadora da GOMBUONE: marketplace + campanhas).
 *
 * Server component com form GET (funciona sem JS, como /lojas):
 *  q → pesquisa por título/descrição/empresa (ILIKE)
 * A lista mostra apenas campanhas ativas/pausadas de vendedores não
 * bloqueados — as mesmas regras de visibilidade do marketplace.
 */

const KIND_LABELS: Record<string, string> = {
  oferta: 'Oferta',
  desconto: 'Desconto',
  missao: 'Missão',
  brinde: 'Brinde',
  evento: 'Evento',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
  const q = first(sp.q).trim().slice(0, 80);
  const like = q ? `%${q}%` : null;

  let campaigns: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    owner_name: string;
    opportunity_count: number;
    codes_issued: number;
    codes_used: number;
  }[] = [];

  try {
    campaigns = (await sql`
      SELECT c.id, c.title, c.description, c.status, c.starts_at, c.ends_at,
             u.name AS owner_name,
             (SELECT COUNT(*)::int FROM opportunities o
               WHERE o.campaign_id = c.id AND o.status = 'ativa') AS opportunity_count,
             (SELECT COUNT(*)::int FROM redemption_codes r
               JOIN opportunities o2 ON o2.id = r.opportunity_id
              WHERE o2.campaign_id = c.id) AS codes_issued,
             (SELECT COUNT(*)::int FROM redemption_codes r
               JOIN opportunities o3 ON o3.id = r.opportunity_id
              WHERE o3.campaign_id = c.id AND r.status = 'utilizado') AS codes_used
      FROM campaigns c
      JOIN users u ON u.id = c.owner_id
      WHERE u.blocked = FALSE
        AND c.status IN ('ativa', 'pausada')
        AND (${like}::text IS NULL
             OR c.title ILIKE ${like}
             OR c.description ILIKE ${like}
             OR u.name ILIKE ${like})
      ORDER BY c.created_at DESC
      LIMIT 60
    `) as unknown as typeof campaigns;
  } catch {
    campaigns = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="animate-float flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/25">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Campanhas e oportunidades</h1>
          <p className="mt-1 text-sm text-slate-500">
            Descobre ofertas, descontos, brindes e missões das empresas — resgata o teu código e valida na loja.
          </p>
        </div>
      </div>

      {/* Pesquisa (form GET — funciona sem JS, como /lojas) */}
      <form
        method="GET"
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        aria-label="Pesquisar campanhas"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Campanha, oferta ou empresa…"
              aria-label="Pesquisar campanhas por título, descrição ou empresa"
              className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="h-11 rounded-md bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Search className="mr-2 inline h-4 w-4" /> Pesquisar
          </button>
        </div>
      </form>

      {/* Resultados */}
      {campaigns.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <PatternWaves />
          <p className="mt-4 text-sm text-slate-400">
            {q
              ? 'Nenhuma campanha encontrada — tenta outra pesquisa ou volta em breve!'
              : 'Ainda não há campanhas ativas — volta em breve para descobrir novas oportunidades!'}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-400" aria-live="polite">
            {campaigns.length} {campaigns.length === 1 ? 'campanha encontrada' : 'campanhas encontradas'}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c, i) => (
              <FadeIn key={c.id} delay={Math.min(i * 0.05, 0.4)} className="h-full">
                <Link
                  href={`/campanhas/${c.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="relative h-24 overflow-hidden bg-gradient-to-r from-blue-600 to-purple-600 transition-transform duration-500 group-hover:scale-105">
                    <PatternWaves />
                    {c.status === 'pausada' && (
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
                        Pausada
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="line-clamp-2 text-base font-bold text-slate-900">{c.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Por {c.owner_name}</p>
                    {c.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.description}</p>
                    )}
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                      <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                      {c.opportunity_count} oportunidade(s) disponível(eis)
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                      {c.codes_issued} código(s) emitidos · {c.codes_used} utilizados
                      {(c.starts_at || c.ends_at) && (
                        <>
                          <CalendarClock className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                          {formatDate(c.starts_at) && (
                            <span className="hidden sm:inline">de {formatDate(c.starts_at)}</span>
                          )}
                          {formatDate(c.ends_at) && <span>até {formatDate(c.ends_at)}</span>}
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              </FadeIn>
            ))}
          </div>
        </>
      )}

      <div className="mt-10">
        <Link
          href="/produtos"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
        >
          <Search className="h-4 w-4" /> Explorar também os produtos e serviços do marketplace
        </Link>
      </div>
    </main>
  );
}
