import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText } from '@/lib/security';
import { listPublicCampaigns, listMyCampaigns } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Campanhas (evolução preservadora da GOMBUONE).
 *
 * GET /api/campanhas         — lista pública de campanhas ativas (descoberta).
 *        ?minhas=1            — campanhas do vendedor autenticado (todas).
 *
 * POST /api/campanhas        — cria uma campanha (apenas vendedores;
 *                              mesmo modelo de posse de products/stores).
 *   Corpo: { title, description?, starts_at?, ends_at? }
 */

const TITLE_MIN = 3;
const TITLE_MAX = 120;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minha = searchParams.get('minhas') === '1';

  if (minha) {
    const user = await getAuthUser(request);
    if (!user || !isSellerRole(user.role)) {
      return NextResponse.json(
        { error: 'Apenas vendedores têm campanhas.' },
        { status: 401 }
      );
    }
    try {
      const campaigns = await listMyCampaigns(user.id);
      return NextResponse.json({ campaigns });
    } catch (error) {
      console.error('[API /api/campanhas] Erro (minhas=1):', error);
      return NextResponse.json({ error: 'Não foi possível carregar as tuas campanhas.' }, { status: 503 });
    }
  }

  if (!rateLimit(clientKey(request, 'campanhas-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const campaigns = await listPublicCampaigns();
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('[API /api/campanhas] Erro no GET:', error);
    return NextResponse.json({ campaigns: [] });
  }
}

/** Valida datas ISO opcionais (YYYY-MM-DD ou ISO completo). */
function parseDate(raw: unknown): Date | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 32) return 'invalid';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isSellerRole(user.role)) {
    return NextResponse.json(
      { error: 'Apenas vendedores podem criar campanhas.' },
      { status: 401 }
    );
  }

  if (!rateLimit(clientKey(request, 'campanhas-post'), 10, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  let body: { title?: unknown; description?: unknown; starts_at?: unknown; ends_at?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const title = sanitizeText(body.title, TITLE_MAX);
  if (title.length < TITLE_MIN) {
    return NextResponse.json(
      { error: `O título da campanha deve ter entre ${TITLE_MIN} e ${TITLE_MAX} caracteres.` },
      { status: 400 }
    );
  }

  const description = sanitizeMultiline(body.description, 2000) || null;

  const startsAt = parseDate(body.starts_at);
  if (startsAt === 'invalid') {
    return NextResponse.json({ error: 'Data de início inválida.' }, { status: 400 });
  }
  const endsAt = parseDate(body.ends_at);
  if (endsAt === 'invalid') {
    return NextResponse.json({ error: 'Data de fim inválida.' }, { status: 400 });
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json(
      { error: 'A data de fim tem de ser posterior à de início.' },
      { status: 400 }
    );
  }

  try {
    const inserted = (await sql`
      INSERT INTO campaigns (owner_id, title, description, starts_at, ends_at)
      VALUES (${user.id}, ${title}, ${description},
              ${startsAt ? startsAt.toISOString() : null},
              ${endsAt ? endsAt.toISOString() : null})
      RETURNING id, owner_id, title, description, status, starts_at, ends_at, created_at, updated_at
    `) as unknown as { id: number }[];

    return NextResponse.json({ ok: true, campaign: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API /api/campanhas] Erro no POST:', error);
    return NextResponse.json({ error: 'Não foi possível criar a campanha agora.' }, { status: 503 });
  }
}
