import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/roles';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText } from '@/lib/security';
import { listOpportunities } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Oportunidades de uma campanha.
 *
 * GET  /api/campanhas/[id]/oportunidades — oportunidades da campanha
 *      (público: apenas ativas; dono/admin: todas).
 * POST /api/campanhas/[id]/oportunidades — o dono cria uma oportunidade.
 *      Corpo: { title, description?, kind?, discount_percent?, mission_text?,
 *               total_codes?, max_claims_per_consumer?, code_ttl_hours? }
 */

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const KINDS = ['oferta', 'desconto', 'missao', 'brinde', 'evento'] as const;
const TOTAL_CODES_MIN = -1;
const TOTAL_CODES_MAX = 100_000;
const CLAIMS_MIN = 1;
const CLAIMS_MAX = 10;
const TTL_MIN = 1;
const TTL_MAX = 720; // 30 dias

function intOrNull(raw: unknown, min: number, max: number): number | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return 'invalid';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return 'invalid';
  return n;
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

  if (!rateLimit(clientKey(request, 'oportunidades-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const user = await getAuthUser(request);
  let includeAll = false;
  if (user) {
    const owned = (await sql`
      SELECT 1 FROM campaigns WHERE id = ${campaignId} AND owner_id = ${user.id} LIMIT 1
    `) as unknown as unknown[];
    includeAll = owned.length > 0 || isAdminRole(user.role);
  }

  try {
    const opportunities = await listOpportunities(campaignId, includeAll);
    return NextResponse.json({ opportunities });
  } catch (error) {
    console.error('[API /api/campanhas/[id]/oportunidades] Erro no GET:', error);
    return NextResponse.json({ opportunities: [] });
  }
}

export async function POST(
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

  if (!rateLimit(clientKey(request, 'oportunidades-post'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  const owned = (await sql`
    SELECT id, status FROM campaigns WHERE id = ${campaignId} LIMIT 1
  `) as unknown as { id: number; status: string }[];
  const campaign = owned[0];
  if (!campaign) {
    return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
  }
  if (campaign.status === 'terminada') {
    return NextResponse.json(
      { error: 'Não é possível adicionar oportunidades a uma campanha terminada.' },
      { status: 400 }
    );
  }

  const isOwner = await (async () => {
    const rows = (await sql`
      SELECT 1 FROM campaigns WHERE id = ${campaignId} AND owner_id = ${user.id} LIMIT 1
    `) as unknown as unknown[];
    return rows.length > 0;
  })();
  if (!isOwner && !isAdminRole(user.role)) {
    return NextResponse.json(
      { error: 'Não tens permissão para adicionar oportunidades a esta campanha.' },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const title = sanitizeText(body.title, TITLE_MAX);
  if (title.length < TITLE_MIN) {
    return NextResponse.json(
      { error: `O título da oportunidade deve ter entre ${TITLE_MIN} e ${TITLE_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const description = sanitizeMultiline(body.description, 2000) || null;

  const kind =
    typeof body.kind === 'string' && (KINDS as readonly string[]).includes(body.kind)
      ? body.kind
      : 'oferta';

  let discountPercent: number | null = null;
  if (body.discount_percent !== undefined && body.discount_percent !== null && body.discount_percent !== '') {
    const dp = Number(body.discount_percent);
    if (!Number.isInteger(dp) || dp < 1 || dp > 100) {
      return NextResponse.json(
        { error: 'O desconto deve ser um número inteiro entre 1 e 100 (%).' },
        { status: 400 }
      );
    }
    if (kind !== 'desconto') {
      return NextResponse.json(
        { error: 'O desconto só se aplica a oportunidades do tipo «desconto».' },
        { status: 400 }
      );
    }
    discountPercent = dp;
  }

  const missionText = sanitizeMultiline(body.mission_text, 1000) || null;

  const totalCodes =
    body.total_codes === undefined || body.total_codes === null || body.total_codes === ''
      ? -1
      : intOrNull(body.total_codes, TOTAL_CODES_MIN, TOTAL_CODES_MAX);
  if (totalCodes === 'invalid') {
    return NextResponse.json(
      { error: 'O total de códigos deve ser -1 (ilimitado) ou um inteiro positivo.' },
      { status: 400 }
    );
  }

  const maxClaims =
    body.max_claims_per_consumer === undefined || body.max_claims_per_consumer === null
      ? 1
      : intOrNull(body.max_claims_per_consumer, CLAIMS_MIN, CLAIMS_MAX);
  if (maxClaims === 'invalid') {
    return NextResponse.json(
      { error: 'O limite por consumidor deve ser um inteiro entre 1 e 10.' },
      { status: 400 }
    );
  }

  const ttl =
    body.code_ttl_hours === undefined || body.code_ttl_hours === null || body.code_ttl_hours === ''
      ? 72
      : intOrNull(body.code_ttl_hours, TTL_MIN, TTL_MAX);
  if (ttl === 'invalid') {
    return NextResponse.json(
      { error: 'A validade do código deve ser entre 1 e 720 horas.' },
      { status: 400 }
    );
  }

  try {
    const inserted = (await sql`
      INSERT INTO opportunities
        (campaign_id, title, description, kind, discount_percent, mission_text,
         total_codes, max_claims_per_consumer, code_ttl_hours)
      VALUES
        (${campaignId}, ${title}, ${description}, ${kind}, ${discountPercent}, ${missionText},
         ${totalCodes}, ${maxClaims}, ${ttl})
      RETURNING id, campaign_id, title, description, kind, discount_percent, mission_text,
                total_codes, max_claims_per_consumer, code_ttl_hours, status, created_at, updated_at
    `) as unknown as { id: number }[];

    return NextResponse.json({ ok: true, opportunity: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API /api/campanhas/[id]/oportunidades] Erro no POST:', error);
    return NextResponse.json({ error: 'Não foi possível criar a oportunidade agora.' }, { status: 503 });
  }
}
