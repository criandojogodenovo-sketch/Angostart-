import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/roles';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText } from '@/lib/security';
import { getCampaign, listOpportunities } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Detalhe/gestão de uma campanha.
 *
 * GET    /api/campanhas/[id] — detalhe público (ativa/pausada) + oportunidades.
 *                              O dono (ou admin) vê também rascunhos/terminadas.
 * PATCH  /api/campanhas/[id] — o dono atualiza title/description/status/datas.
 *                              Campos enviados = atualizados; campo null/'' =
 *                              limpo; campo ausente = mantém (CASE explícito).
 * DELETE /api/campanhas/[id] — o dono (ou admin) elimina (cascade, como
 *                              products/[id]). Se já tem códigos utilizados,
 *                              arquiva como «terminada» (preserva resultados).
 */

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const VALID_STATUSES = ['rascunho', 'ativa', 'pausada', 'terminada'] as const;

async function loadOwnedCampaign(id: number, userId: number, isAdmin: boolean) {
  const rows = (await sql`
    SELECT id, owner_id, status FROM campaigns WHERE id = ${id} LIMIT 1
  `) as unknown as { id: number; owner_id: number; status: string }[];
  const campaign = rows[0];
  if (!campaign) return { error: 'not-found' as const };
  if (campaign.owner_id !== userId && !isAdmin) return { error: 'forbidden' as const };
  return { campaign };
}

async function isCampaignOwner(campaignId: number, userId: number): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM campaigns WHERE id = ${campaignId} AND owner_id = ${userId} LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 });
  }

  if (!rateLimit(clientKey(request, 'campanha-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const user = await getAuthUser(request);
  const isOwnerOrAdmin =
    !!user && (isAdminRole(user.role) || (await isCampaignOwner(campaignId, user.id)));

  try {
    const campaign = await getCampaign(campaignId, isOwnerOrAdmin);
    if (!campaign) {
      return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
    }
    const opportunities = await listOpportunities(campaignId, isOwnerOrAdmin);
    return NextResponse.json({ campaign, opportunities });
  } catch (error) {
    console.error('[API /api/campanhas/[id]] Erro no GET:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a campanha.' }, { status: 503 });
  }
}

/** Valida datas ISO opcionais: null (ausente) | Date | 'invalid'. */
function parseDate(raw: unknown): Date | null | 'invalid' | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 32) return 'invalid';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'campanha-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  const owned = await loadOwnedCampaign(campaignId, user.id, isAdminRole(user.role));
  if (owned.error === 'not-found') {
    return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
  }
  if (owned.error === 'forbidden') {
    return NextResponse.json({ error: 'Não tens permissão para editar esta campanha.' }, { status: 403 });
  }

  let body: {
    title?: unknown;
    description?: unknown;
    status?: unknown;
    starts_at?: unknown;
    ends_at?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const titleProvided = body.title !== undefined;
  /* Quando ausente, '' é ignorado pelo CASE (mantém o valor atual). */
  const title = titleProvided ? sanitizeText(body.title, TITLE_MAX) : '';
  if (titleProvided && title.length < TITLE_MIN) {
    return NextResponse.json(
      { error: `O título da campanha deve ter entre ${TITLE_MIN} e ${TITLE_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const descProvided = body.description !== undefined;
  const description = descProvided ? sanitizeMultiline(body.description, 2000) || null : null;

  const statusProvided =
    typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status);
  const status = statusProvided ? (body.status as string) : null;

  const startsAt = parseDate(body.starts_at);
  if (startsAt === 'invalid') {
    return NextResponse.json({ error: 'Data de início inválida.' }, { status: 400 });
  }
  const endsAt = parseDate(body.ends_at);
  if (endsAt === 'invalid') {
    return NextResponse.json({ error: 'Data de fim inválida.' }, { status: 400 });
  }
  if (startsAt instanceof Date && endsAt instanceof Date && endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json(
      { error: 'A data de fim tem de ser posterior à de início.' },
      { status: 400 }
    );
  }

  try {
    /* CASE por campo: enviado → novo valor (null limpa); ausente → mantém. */
    const updated = (await sql`
      UPDATE campaigns
      SET title = CASE WHEN ${titleProvided} THEN ${title} ELSE title END,
          description = CASE WHEN ${descProvided} THEN ${description} ELSE description END,
          status = CASE WHEN ${statusProvided} THEN ${status} ELSE status END,
          starts_at = CASE WHEN ${startsAt !== undefined}
                       THEN ${startsAt ? startsAt.toISOString() : null} ELSE starts_at END,
          ends_at = CASE WHEN ${endsAt !== undefined}
                     THEN ${endsAt ? endsAt.toISOString() : null} ELSE ends_at END,
          updated_at = now()
      WHERE id = ${campaignId}
      RETURNING id, owner_id, title, description, status, starts_at, ends_at, created_at, updated_at
    `) as unknown as unknown[];

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
    }
    const campaign = await getCampaign(campaignId, true);
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    console.error('[API /api/campanhas/[id]] Erro no PATCH:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a campanha agora.' }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'campanha-delete'), 10, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const owned = await loadOwnedCampaign(campaignId, user.id, isAdminRole(user.role));
  if (owned.error === 'not-found') {
    return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
  }
  if (owned.error === 'forbidden') {
    return NextResponse.json({ error: 'Não tens permissão para eliminar esta campanha.' }, { status: 403 });
  }

  try {
    /* Campanhas com códigos já utilizados preservam o histórico de
       resultados — são arquivadas como «terminada» em vez de apagadas. */
    const used = (await sql`
      SELECT COUNT(*)::int AS n FROM redemption_codes r
        JOIN opportunities o ON o.id = r.opportunity_id
       WHERE o.campaign_id = ${campaignId} AND r.status = 'utilizado'
    `) as unknown as { n: number }[];

    if ((used[0]?.n ?? 0) > 0) {
      await sql`
        UPDATE campaigns SET status = 'terminada', updated_at = now()
         WHERE id = ${campaignId}
      `;
      return NextResponse.json({
        ok: true,
        archived: true,
        message:
          'A campanha tem resultados válidos — foi arquivada como terminada (histórico preservado).',
      });
    }

    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    return NextResponse.json({ ok: true, archived: false });
  } catch (error) {
    console.error('[API /api/campanhas/[id]] Erro no DELETE:', error);
    return NextResponse.json({ error: 'Não foi possível eliminar a campanha agora.' }, { status: 503 });
  }
}
