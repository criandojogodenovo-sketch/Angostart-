import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/roles';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText } from '@/lib/security';
import { getOpportunity } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Gestão de uma oportunidade.
 *
 * GET    /api/oportunidades/[id] — detalhe (público se ativa; dono/admin sempre).
 * PATCH  /api/oportunidades/[id] — o dono atualiza campos (CASE por campo).
 * DELETE /api/oportunidades/[id] — o dono elimina (apenas sem códigos
 *                                  utilizados — senão marca «terminada»).
 */

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const KINDS = ['oferta', 'desconto', 'missao', 'brinde', 'evento'] as const;
const STATUSES = ['ativa', 'pausada', 'esgotada', 'terminada'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const opportunityId = Number(id);
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'Oportunidade inválida.' }, { status: 400 });
  }

  if (!rateLimit(clientKey(request, 'oportunidade-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const user = await getAuthUser(request);
  const opportunity = await getOpportunity(opportunityId);
  if (!opportunity) {
    return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
  }

  const isOwner = !!user && (user.id === opportunity.campaign_owner_id || isAdminRole(user.role));
  if (!isOwner && opportunity.status !== 'ativa') {
    /* Não expõe rascunhos/pausadas ao público. */
    return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
  }

  const stats = (await sql`
    SELECT COUNT(*)::int AS issued,
           COUNT(*) FILTER (WHERE status = 'utilizado')::int AS used
      FROM redemption_codes WHERE opportunity_id = ${opportunityId}
  `) as unknown as { issued: number; used: number }[];

  const { campaign_owner_id, campaign_status, ...safe } = opportunity;
  return NextResponse.json({
    opportunity: {
      ...safe,
      codes_issued: Number(stats[0]?.issued ?? 0),
      codes_used: Number(stats[0]?.used ?? 0),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const opportunityId = Number(id);
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'Oportunidade inválida.' }, { status: 400 });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'oportunidade-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  const opportunity = await getOpportunity(opportunityId);
  if (!opportunity) {
    return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
  }
  if (opportunity.campaign_owner_id !== user.id && !isAdminRole(user.role)) {
    return NextResponse.json({ error: 'Não tens permissão para editar esta oportunidade.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const titleProvided = body.title !== undefined;
  /* Quando ausente, '' é ignorado pelo CASE (mantém o valor atual). */
  const title = titleProvided ? sanitizeText(body.title, TITLE_MAX) : '';
  if (titleProvided && title.length < TITLE_MIN) {
    return NextResponse.json(
      { error: `O título deve ter entre ${TITLE_MIN} e ${TITLE_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const descProvided = body.description !== undefined;
  const description = descProvided ? sanitizeMultiline(body.description, 2000) || null : null;

  const missionProvided = body.mission_text !== undefined;
  const missionText = missionProvided ? sanitizeMultiline(body.mission_text, 1000) || null : null;

  const kindProvided =
    typeof body.kind === 'string' && (KINDS as readonly string[]).includes(body.kind);
  const kind = kindProvided ? (body.kind as string) : null;

  let discountProvided = body.discount_percent !== undefined;
  let discountPercent: number | null = null;
  if (discountProvided) {
    if (body.discount_percent === null || body.discount_percent === '') {
      discountPercent = null;
    } else {
      const dp = Number(body.discount_percent);
      if (!Number.isInteger(dp) || dp < 1 || dp > 100) {
        return NextResponse.json({ error: 'O desconto deve ser entre 1 e 100 (%).' }, { status: 400 });
      }
      discountPercent = dp;
    }
  }

  const statusProvided =
    typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status);
  const status = statusProvided ? (body.status as string) : null;

  const intField = (
    raw: unknown,
    min: number,
    max: number
  ): number | 'invalid' | undefined => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return 'invalid';
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) return 'invalid';
    return n;
  };
  const totalCodes = intField(body.total_codes, -1, 100_000);
  if (totalCodes === 'invalid') {
    return NextResponse.json({ error: 'Total de códigos inválido (-1 = ilimitado).' }, { status: 400 });
  }
  const maxClaims = intField(body.max_claims_per_consumer, 1, 10);
  if (maxClaims === 'invalid') {
    return NextResponse.json({ error: 'Limite por consumidor deve ser entre 1 e 10.' }, { status: 400 });
  }
  const ttl = intField(body.code_ttl_hours, 1, 720);
  if (ttl === 'invalid') {
    return NextResponse.json({ error: 'Validade do código deve ser entre 1 e 720 horas.' }, { status: 400 });
  }

  try {
    const updated = (await sql`
      UPDATE opportunities
      SET title = CASE WHEN ${titleProvided} THEN ${title} ELSE title END,
          description = CASE WHEN ${descProvided} THEN ${description} ELSE description END,
          mission_text = CASE WHEN ${missionProvided} THEN ${missionText} ELSE mission_text END,
          kind = CASE WHEN ${kindProvided} THEN ${kind} ELSE kind END,
          discount_percent = CASE WHEN ${discountProvided} THEN ${discountPercent} ELSE discount_percent END,
          status = CASE WHEN ${statusProvided} THEN ${status} ELSE status END,
          total_codes = CASE WHEN ${totalCodes !== undefined} THEN ${totalCodes ?? null} ELSE total_codes END,
          max_claims_per_consumer = CASE WHEN ${maxClaims !== undefined} THEN ${maxClaims ?? null} ELSE max_claims_per_consumer END,
          code_ttl_hours = CASE WHEN ${ttl !== undefined} THEN ${ttl ?? null} ELSE code_ttl_hours END,
          updated_at = now()
      WHERE id = ${opportunityId}
      RETURNING id
    `) as unknown as unknown[];

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
    }
    const fresh = await getOpportunity(opportunityId);
    const { campaign_owner_id: _o, campaign_status: _s, ...safe } = fresh!;
    return NextResponse.json({ ok: true, opportunity: safe });
  } catch (error) {
    console.error('[API /api/oportunidades/[id]] Erro no PATCH:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a oportunidade agora.' }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const opportunityId = Number(id);
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'Oportunidade inválida.' }, { status: 400 });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'oportunidade-delete'), 10, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const opportunity = await getOpportunity(opportunityId);
  if (!opportunity) {
    return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
  }
  if (opportunity.campaign_owner_id !== user.id && !isAdminRole(user.role)) {
    return NextResponse.json({ error: 'Não tens permissão para eliminar esta oportunidade.' }, { status: 403 });
  }

  try {
    const used = (await sql`
      SELECT COUNT(*)::int AS n FROM redemption_codes
       WHERE opportunity_id = ${opportunityId} AND status = 'utilizado'
    `) as unknown as { n: number }[];

    if ((used[0]?.n ?? 0) > 0) {
      await sql`
        UPDATE opportunities SET status = 'terminada', updated_at = now()
         WHERE id = ${opportunityId}
      `;
      return NextResponse.json({
        ok: true,
        archived: true,
        message: 'A oportunidade já foi utilizada — arquivada como terminada (histórico preservado).',
      });
    }

    await sql`DELETE FROM opportunities WHERE id = ${opportunityId}`;
    return NextResponse.json({ ok: true, archived: false });
  } catch (error) {
    console.error('[API /api/oportunidades/[id]] Erro no DELETE:', error);
    return NextResponse.json({ error: 'Não foi possível eliminar a oportunidade agora.' }, { status: 503 });
  }
}
