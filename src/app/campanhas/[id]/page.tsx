import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import {
  Megaphone,
  Ticket,
  Percent,
  Gift,
  Target,
  CalendarClock,
  Store,
  ArrowLeft,
} from 'lucide-react';
import { FadeIn } from '@/components/motion';
import ClaimButton from '@/components/campaigns/ClaimButton';
import ShareButton from '@/components/ShareButton';
import AffiliateCopyButton from '@/components/AffiliateCopyButton';
import VerifiedBadge from '@/components/VerifiedBadge';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — /campanhas/[id] — detalhe público de uma campanha com as
 * suas oportunidades (ofertas, descontos, missões, brindes, eventos).
 *
 * - Missão = ação verificável descrita na oportunidade; o consumidor
 *   cumpre-a e apresenta o código GMB-XXXXXX na loja (validação atómica).
 * - Distribuição: botões de partilha — link público (ShareButton) e link
 *   de afiliado com ?ref=AFG-XXXXXX (AffiliateCopyButton, apenas para
 *   afiliados), reutilizando o sistema existente de attribution.
 */

const KIND_META: Record<
  string,
  { label: string; icon: typeof Ticket; classes: string }
> = {
  oferta: { label: 'Oferta', icon: Ticket, classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  desconto: { label: 'Desconto', icon: Percent, classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  missao: { label: 'Missão', icon: Target, classes: 'bg-violet-50 text-violet-700 border-violet-200' },
  brinde: { label: 'Brinde', icon: Gift, classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  evento: { label: 'Evento', icon: CalendarClock, classes: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function loadCampaign(id: number) {
  const rows = (await sql`
    SELECT c.id, c.title, c.description, c.status, c.starts_at, c.ends_at,
           c.created_at, u.name AS owner_name, u.is_verified_bi::boolean AS verified,
           (SELECT s.slug FROM stores s WHERE s.owner_id = c.owner_id LIMIT 1) AS store_slug
      FROM campaigns c
      JOIN users u ON u.id = c.owner_id
     WHERE c.id = ${id} AND c.status IN ('ativa', 'pausada') AND u.blocked = FALSE
     LIMIT 1
  `) as unknown as {
    id: number;
    title: string;
    description: string | null;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string;
    owner_name: string;
    verified: boolean;
    store_slug: string | null;
  }[];
  return rows[0] ?? null;
}

async function loadOpportunities(campaignId: number) {
  return (await sql`
    SELECT id, title, description, kind, discount_percent, mission_text,
           total_codes, code_ttl_hours, status,
           (SELECT COUNT(*)::int FROM redemption_codes r WHERE r.opportunity_id = opportunities.id) AS codes_issued
      FROM opportunities
     WHERE campaign_id = ${campaignId} AND status = 'ativa'
     ORDER BY created_at DESC
  `) as unknown as {
    id: number;
    title: string;
    description: string | null;
    kind: string;
    discount_percent: number | null;
    mission_text: string | null;
    total_codes: number;
    code_ttl_hours: number;
    status: string;
    codes_issued: number;
  }[];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return { title: 'Campanha' };
  try {
    const campaign = await loadCampaign(campaignId);
    if (!campaign) return { title: 'Campanha não encontrada' };
    return {
      title: `${campaign.title} — Campanha GOMBUONE`,
      description:
        campaign.description?.slice(0, 160) ??
        `Oportunidades de ${campaign.owner_name} — resgata o teu código e valida na loja.`,
    };
  } catch {
    return { title: 'Campanha' };
  }
}

export default async function CampanhaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();

  let campaign: Awaited<ReturnType<typeof loadCampaign>> | null = null;
  let opportunities: Awaited<ReturnType<typeof loadOpportunities>> = [];
  try {
    campaign = await loadCampaign(campaignId);
    if (!campaign) notFound();
    opportunities = await loadOpportunities(campaignId);
  } catch {
    notFound();
  }

  const startsAt = formatDate(campaign.starts_at);
  const endsAt = formatDate(campaign.ends_at);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/campanhas"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" /> Todas as campanhas
      </Link>

      {/* Cabeçalho da campanha */}
      <FadeIn className="mt-4">
        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-8 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                <Megaphone className="h-5 w-5" aria-hidden="true" />
              </span>
              <h1 className="text-2xl font-extrabold sm:text-3xl">{campaign.title}</h1>
            </div>
            {campaign.description && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-blue-50">
                {campaign.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-6 py-4">
            <span className="flex items-center gap-1.5 text-sm text-slate-600">
              <Store className="h-4 w-4 text-blue-600" aria-hidden="true" />
              {campaign.store_slug ? (
                <Link
                  href={`/loja/${campaign.store_slug}`}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  {campaign.owner_name}
                </Link>
              ) : (
                <span className="font-semibold">{campaign.owner_name}</span>
              )}
              {campaign.verified && <VerifiedBadge size={14} />}
            </span>
            {(startsAt || endsAt) && (
              <span className="flex items-center gap-1.5 text-sm text-slate-500">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {startsAt && <span>de {startsAt}</span>}
                {endsAt && <span>até {endsAt}</span>}
              </span>
            )}
            {campaign.status === 'pausada' && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                Campanha pausada — oportunidades indisponíveis temporariamente
              </span>
            )}
          </div>
        </header>
      </FadeIn>

      {/* Partilha/distribuição — link público + link de afiliado (refCode) */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ShareButton
          productUrl={`/campanhas/${campaign.id}`}
          label="Partilhar campanha"
        />
        <AffiliateCopyButton
          path={`/campanhas/${campaign.id}`}
          label="Partilhar como distribuidor"
        />
      </div>

      {/* Oportunidades */}
      <section className="mt-8" aria-label="Oportunidades desta campanha">
        <h2 className="text-lg font-extrabold text-slate-900">
          Oportunidades ({opportunities.length})
        </h2>
        {campaign.status === 'pausada' ? (
          <p className="mt-3 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
            A campanha está pausada — as oportunidades voltam a ficar disponíveis quando a empresa a reativar.
          </p>
        ) : opportunities.length === 0 ? (
          <p className="mt-3 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
            Esta campanha ainda não tem oportunidades publicadas — volta em breve!
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {opportunities.map((o, i) => {
              const meta = KIND_META[o.kind] ?? KIND_META.oferta;
              const KindIcon = meta.icon;
              const esgotada =
                o.total_codes >= 0 && o.codes_issued >= o.total_codes;
              return (
                <FadeIn key={o.id} delay={Math.min(i * 0.05, 0.3)} className="h-full">
                  <article className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-900">{o.title}</h3>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.classes}`}
                      >
                        <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </div>

                    {o.discount_percent !== null && (
                      <p className="mt-2 text-2xl font-extrabold text-emerald-600">
                        -{o.discount_percent}%
                      </p>
                    )}
                    {o.description && (
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{o.description}</p>
                    )}
                    {o.mission_text && (
                      <div className="mt-3 rounded-xl bg-violet-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-violet-700">
                          <Target className="h-3.5 w-3.5" aria-hidden="true" /> Missão
                        </p>
                        <p className="mt-1 text-sm text-violet-900">{o.mission_text}</p>
                      </div>
                    )}

                    <p className="mt-3 text-xs text-slate-400">
                      Válido por {o.code_ttl_hours}h após o resgate
                      {o.total_codes >= 0 &&
                        ` · ${Math.max(o.total_codes - o.codes_issued, 0)} código(s) restante(s)`}
                    </p>

                    <div className="mt-4">
                      {esgotada ? (
                        <span className="inline-flex h-11 items-center rounded-xl bg-slate-100 px-6 text-sm font-semibold text-slate-400">
                          Códigos esgotados
                        </span>
                      ) : (
                        <ClaimButton opportunityId={o.id} />
                      )}
                    </div>
                  </article>
                </FadeIn>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
