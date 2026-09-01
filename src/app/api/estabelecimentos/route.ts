import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  requireSeller,
  clientKey,
  rateLimit,
  sanitizeText,
  sanitizeMultiline,
} from '@/lib/security';
import { isInternalMediaUrl } from '@/lib/payments-manual';
import { parseCoord, ANGOLA_LAT, ANGOLA_LNG } from '@/lib/geo';
import {
  isValidBusinessCategory,
  type BusinessProfile,
} from '@/lib/business';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Fase 16 — Estabelecimentos (lojas, hotéis, empresas) com localização fixa.
 *
 * GET  /api/estabelecimentos           — diretório público (ativos)
 *   ?categoria=&cidade=&limit=
 * GET  /api/estabelecimentos?meu=1     — o meu estabelecimento (autenticado)
 * POST /api/estabelecimentos           — criar/atualizar o meu (vendedor)
 *   { name, category, description, address, latitude, longitude,
 *     horario, logo_url, fotos[], active }
 *
 * 🔒 Privacidade: apenas o endereço + coordenadas DO ESTABELECIMENTO (dados
 * comerciais públicos, como no Google Maps) — nunca dados pessoais.
 */

const MAX_FOTOS = 6;

/* ──────────────────────────── GET ──────────────────────────── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const meu = searchParams.get('meu') === '1';
  const categoria = searchParams.get('categoria');
  const cidade = sanitizeText(searchParams.get('cidade'), 80);
  const limit = Math.min(60, Math.max(1, Number(searchParams.get('limit')) || 40));

  if (meu) {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
    }
    try {
      const rows = (await sql`
        SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
        FROM business_profiles b
        JOIN users u ON u.id = b.user_id
        WHERE b.user_id = ${user.id}
        LIMIT 1
      `) as unknown as BusinessProfile[];
      return NextResponse.json({ business: rows[0] ?? null }, { status: 200 });
    } catch (error) {
      console.error('[API estabelecimentos GET meu] Erro:', error);
      return NextResponse.json({ error: 'Não foi possível carregar o estabelecimento.' }, { status: 503 });
    }
  }

  if (categoria && !isValidBusinessCategory(categoria)) {
    return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
  }

  if (!rateLimit(clientKey(request, 'business-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const items =
      categoria && cidade
        ? ((await sql`
            SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
            FROM business_profiles b
            JOIN users u ON u.id = b.user_id
            WHERE b.active = TRUE AND b.category = ${categoria}
              AND (u.cidade ILIKE ${'%' + cidade + '%'} OR b.address ILIKE ${'%' + cidade + '%'})
            ORDER BY b.created_at DESC
            LIMIT ${limit}
          `) as unknown as BusinessProfile[])
        : categoria
          ? ((await sql`
              SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
              FROM business_profiles b
              JOIN users u ON u.id = b.user_id
              WHERE b.active = TRUE AND b.category = ${categoria}
              ORDER BY b.created_at DESC
              LIMIT ${limit}
            `) as unknown as BusinessProfile[])
          : cidade
            ? ((await sql`
                SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
                FROM business_profiles b
                JOIN users u ON u.id = b.user_id
                WHERE b.active = TRUE
                  AND (u.cidade ILIKE ${'%' + cidade + '%'} OR b.address ILIKE ${'%' + cidade + '%'})
                ORDER BY b.created_at DESC
                LIMIT ${limit}
              `) as unknown as BusinessProfile[])
            : ((await sql`
                SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
                FROM business_profiles b
                JOIN users u ON u.id = b.user_id
                WHERE b.active = TRUE
                ORDER BY b.created_at DESC
                LIMIT ${limit}
              `) as unknown as BusinessProfile[]);

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error('[API estabelecimentos GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os estabelecimentos.' }, { status: 503 });
  }
}

/* ──────────────────────────── POST ─────────────────────────── */

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  if (!rateLimit(clientKey(request, `business-post:${user.id}`), 10, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas alterações seguidas. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const name = sanitizeText(body.name, 120);
  const category =
    typeof body.category === 'string' && isValidBusinessCategory(body.category)
      ? body.category
      : 'outro';
  const description = sanitizeMultiline(body.description ?? '', 2000) || null;
  const address = sanitizeText(body.address ?? '', 200) || null;
  const horario = sanitizeText(body.horario ?? '', 200) || null;
  const active = body.active === false ? false : true;

  // Localização do ESTABELECIMENTO (fixa) — valida bounds de Angola
  let latitude: number | null = null;
  let longitude: number | null = null;
  const latParsed = parseCoord(body.latitude, ANGOLA_LAT);
  const lngParsed = parseCoord(body.longitude, ANGOLA_LNG);
  if (latParsed !== null && lngParsed !== null) {
    latitude = latParsed;
    longitude = lngParsed;
  }

  if (name.length < 3) {
    return NextResponse.json({ error: 'O nome do estabelecimento deve ter pelo menos 3 caracteres.' }, { status: 400 });
  }

  // Logo: apenas URL interno de media
  const logoUrl = typeof body.logo_url === 'string' && body.logo_url.trim() !== ''
    ? body.logo_url.trim()
    : null;
  if (logoUrl && !isInternalMediaUrl(logoUrl)) {
    return NextResponse.json(
      { error: 'O logo deve ser enviado pelo upload da AngoStart.' },
      { status: 400 }
    );
  }

  // Galeria de fotos (máx. 6, todas internas)
  let fotos: string[] = [];
  if (Array.isArray(body.fotos)) {
    fotos = (body.fotos as unknown[])
      .filter((f): f is string => typeof f === 'string' && isInternalMediaUrl(f))
      .slice(0, MAX_FOTOS);
  }

  try {
    // Upsert por user_id (1 estabelecimento por vendedor)
    await sql`
      INSERT INTO business_profiles
        (user_id, name, category, description, address, latitude, longitude, horario, logo_url, fotos, active)
      VALUES
        (${user.id}, ${name}, ${category}, ${description}, ${address}, ${latitude}, ${longitude}, ${horario}, ${logoUrl}, ${fotos}, ${active})
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        address = EXCLUDED.address,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        horario = EXCLUDED.horario,
        logo_url = EXCLUDED.logo_url,
        fotos = EXCLUDED.fotos,
        active = EXCLUDED.active,
        updated_at = NOW()
    `;

    const rows = (await sql`
      SELECT * FROM business_profiles WHERE user_id = ${user.id} LIMIT 1
    `) as unknown as BusinessProfile[];

    return NextResponse.json({ ok: true, business: rows[0] }, { status: 201 });
  } catch (error) {
    console.error('[API estabelecimentos POST] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível guardar o estabelecimento agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
