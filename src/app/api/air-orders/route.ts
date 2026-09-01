import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeText, sanitizeMultiline } from '@/lib/security';
import {
  AIR_ORDER_CATEGORIES,
  AIR_ORDER_TITLE_MAX,
  AIR_ORDER_DESC_MAX,
  isValidAirOrderCategory,
  type AirOrderRow,
} from '@/lib/air-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Fase 16 — «Pedidos no Ar» (MIXA): modelo Uber de aceitação única.
 *
 * GET  /api/air-orders           — lista pública de pedidos abertos
 *   ?categoria=<value>           — filtro por categoria
 *   ?cidade=<nome>               — filtro por cidade (ILIKE)
 *   ?meus=1                      — pedidos publicados por mim (autenticado)
 *   ?aceites=1                   — pedidos aceites por mim (autenticado)
 *   ?limit=                      — paginação simples
 *
 * POST /api/air-orders           — publicar novo pedido (qualquer utilizador)
 *
 * 🔒 PRIVACIDADE: a listagem NUNCA expõe telefones/emails — apenas o nome
 * público de quem publicou. `detectContactSharing` bloqueia tentativas de
 * colocar contactos no título/descrição (mesma regra do chat).
 */

const VALID_CATEGORIES = new Set(AIR_ORDER_CATEGORIES.map((c) => c.value));

/* ─────────────────────────── GET — listar ─────────────────────────── */

export async function GET(request: NextRequest) {
  // Catálogo público — leitura generosa mas limitada
  if (!rateLimit(clientKey(request, 'air-orders-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const categoria = searchParams.get('categoria');
  const cidade = sanitizeText(searchParams.get('cidade'), 80);
  const meus = searchParams.get('meus') === '1';
  const aceites = searchParams.get('aceites') === '1';
  const limit = Math.min(60, Math.max(1, Number(searchParams.get('limit')) || 30));

  // Para ?meus=1 / ?aceites=1 é preciso sessão
  if (meus || aceites) {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
    }

    try {
      const rows =
        meus
          ? ((await sql`
              SELECT a.*, u.name AS publisher_name, p.name AS provider_name
              FROM air_orders a
              JOIN users u ON u.id = a.user_id
              LEFT JOIN users p ON p.id = a.provider_id
              WHERE a.user_id = ${user.id}
              ORDER BY a.created_at DESC
              LIMIT ${limit}
            `) as unknown as AirOrderRow[])
          : ((await sql`
              SELECT a.*, u.name AS publisher_name, p.name AS provider_name
              FROM air_orders a
              JOIN users u ON u.id = a.user_id
              LEFT JOIN users p ON p.id = a.provider_id
              WHERE a.provider_id = ${user.id}
              ORDER BY a.updated_at DESC
              LIMIT ${limit}
            `) as unknown as AirOrderRow[]);

      return NextResponse.json({ items: rows }, { status: 200 });
    } catch (error) {
      console.error('[API air-orders GET] Erro (meus/aceites):', error);
      return NextResponse.json({ error: 'Não foi possível carregar os pedidos.' }, { status: 503 });
    }
  }

  if (categoria && !VALID_CATEGORIES.has(categoria)) {
    return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
  }

  try {
    // Driver Neon: sem fragmentos aninhados — queries ramificadas
    const items =
      categoria && cidade
        ? ((await sql`
            SELECT a.*, u.name AS publisher_name, p.name AS provider_name
            FROM air_orders a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN users p ON p.id = a.provider_id
            WHERE a.status = 'aberto'
              AND a.category = ${categoria}
              AND a.cidade ILIKE ${'%' + cidade + '%'}
            ORDER BY a.created_at DESC
            LIMIT ${limit}
          `) as unknown as AirOrderRow[])
        : categoria
          ? ((await sql`
              SELECT a.*, u.name AS publisher_name, p.name AS provider_name
              FROM air_orders a
              JOIN users u ON u.id = a.user_id
              LEFT JOIN users p ON p.id = a.provider_id
              WHERE a.status = 'aberto'
                AND a.category = ${categoria}
              ORDER BY a.created_at DESC
              LIMIT ${limit}
            `) as unknown as AirOrderRow[])
          : cidade
            ? ((await sql`
                SELECT a.*, u.name AS publisher_name, p.name AS provider_name
                FROM air_orders a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN users p ON p.id = a.provider_id
                WHERE a.status = 'aberto'
                  AND a.cidade ILIKE ${'%' + cidade + '%'}
                ORDER BY a.created_at DESC
                LIMIT ${limit}
              `) as unknown as AirOrderRow[])
            : ((await sql`
                SELECT a.*, u.name AS publisher_name, p.name AS provider_name
                FROM air_orders a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN users p ON p.id = a.provider_id
                WHERE a.status = 'aberto'
                ORDER BY a.created_at DESC
                LIMIT ${limit}
              `) as unknown as AirOrderRow[]);

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error('[API air-orders GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os pedidos.' }, { status: 503 });
  }
}

/* ───────────────────────── POST — publicar ────────────────────────── */

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }

  // 8 publicações / 10 minutos por utilizador
  if (!rateLimit(clientKey(request, `air-orders-post:${user.id}`), 8, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos publicados seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: {
    title?: unknown;
    description?: unknown;
    category?: unknown;
    budget_kz?: unknown;
    cidade?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const title = sanitizeText(body.title, AIR_ORDER_TITLE_MAX);
  const description = sanitizeMultiline(body.description, AIR_ORDER_DESC_MAX);
  const category =
    typeof body.category === 'string' && isValidAirOrderCategory(body.category)
      ? body.category
      : 'outro';
  const cidade = sanitizeText(body.cidade ?? user.cidade, 80) || null;

  const budgetRaw =
    typeof body.budget_kz === 'number'
      ? body.budget_kz
      : typeof body.budget_kz === 'string' && body.budget_kz.trim() !== ''
        ? Number(body.budget_kz.replace(/[^\d.,]/g, '').replace(',', '.'))
        : null;
  const budgetKz =
    budgetRaw !== null && Number.isFinite(budgetRaw) && budgetRaw >= 0
      ? Math.round(budgetRaw * 100) / 100
      : null;

  if (title.length < 5) {
    return NextResponse.json(
      { error: 'O título deve ter pelo menos 5 caracteres.' },
      { status: 400 }
    );
  }
  if (description.length < 10) {
    return NextResponse.json(
      { error: 'Descreve o pedido com pelo menos 10 caracteres — os prestadores precisam de contexto.' },
      { status: 400 }
    );
  }

  /* ── Anti-fraude: NUNCA permitir contactos no texto (privacidade) ── */
  try {
    const { detectContactSharing } = await import('@/lib/antifraud');
    const violation = detectContactSharing(`${title}\n${description}`);
    if (violation.length > 0) {
      return NextResponse.json(
        {
          error:
            'Por privacidade e segurança, não inclucas telefones, emails ou WhatsApp no pedido. Toda a comunicação passa pelo chat da AngoStart.',
          blocked: 'contact_sharing',
        },
        { status: 400 }
      );
    }
  } catch {
    /* se o módulo falhar, segue o fluxo (defesa em profundidade noutra camada) */
  }

  try {
    const rows = (await sql`
      INSERT INTO air_orders (user_id, category, title, description, budget_kz, cidade)
      VALUES (${user.id}, ${category}, ${title}, ${description}, ${budgetKz}, ${cidade})
      RETURNING *
    `) as unknown as AirOrderRow[];

    return NextResponse.json({ ok: true, order: rows[0] }, { status: 201 });
  } catch (error) {
    console.error('[API air-orders POST] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível publicar o pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
