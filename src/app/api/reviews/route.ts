import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  clientKey,
  rateLimit,
  requireRole,
  sanitizeMultiline,
} from '@/lib/security';
import { checkSellerComplaints } from '@/lib/antifraud';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reviews?product_id=123 — avaliações públicas do produto
 * (lista + média + contagem).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const productId = Number(searchParams.get('product_id'));

  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT r.id, r.rating, r.comment, r.created_at,
             u.name AS user_name, u.username AS user_username
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.product_id = ${productId}
      ORDER BY r.created_at DESC
      LIMIT 100
    `) as unknown as {
      id: number;
      rating: number;
      comment: string;
      created_at: string;
      user_name: string | null;
      user_username: string | null;
    }[];

    const aggregate = (await sql`
      SELECT COALESCE(AVG(rating), 0)::float8 AS average, count(*)::int AS count
      FROM reviews WHERE product_id = ${productId}
    `) as unknown as { average: number; count: number }[];

    return NextResponse.json({
      reviews: rows,
      average: Math.round((aggregate[0]?.average ?? 0) * 10) / 10,
      count: aggregate[0]?.count ?? 0,
    });
  } catch (error) {
    console.error('[API /api/reviews] Erro no GET:', error);
    return NextResponse.json({ reviews: [], average: 0, count: 0 });
  }
}

/**
 * POST /api/reviews — cria/atualiza a avaliação do utilizador autenticado.
 * 🔒 Só é permitido APÓS COMPRA CONFIRMADA (encomenda com estado
 * 'pago' ou 'entregue' que contenha o produto).
 * Corpo: { product_id, rating (1-5), comment }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request); // qualquer conta válida (não bloqueada)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'reviews-post'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento antes de avaliar novamente.' }, { status: 429 });
  }

  let body: { product_id?: unknown; rating?: unknown; comment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const productId = Number(body.product_id);
  const rating = Math.round(Number(body.rating));
  const comment = sanitizeMultiline(body.comment, 1000);

  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'Escolhe uma classificação de 1 a 5 estrelas.' },
      { status: 400 }
    );
  }

  try {
    const product = (await sql`
      SELECT id, user_id FROM products WHERE id = ${productId} LIMIT 1
    `) as unknown as { id: number; user_id: number | null }[];
    if (!product[0]) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }

    // 🔒 Anti-auto-avaliação (Fase 6, ponto 6): ninguém avalia o próprio
    // produto — o user_id do avaliador não pode ser o do vendedor.
    if (product[0].user_id === auth.user.id) {
      return NextResponse.json(
        { error: 'Não podes avaliar o teu próprio produto.' },
        { status: 403 }
      );
    }

    // 🔒 Compra confirmada obrigatória: encomenda paga/entregue com este produto
    const purchase = (await sql`
      SELECT 1 FROM orders
      WHERE user_id = ${auth.user.id}
        AND status IN ('pago', 'entregue')
        AND items @> ${JSON.stringify([{ id: productId }])}::jsonb
      LIMIT 1
    `) as unknown as unknown[];

    if (purchase.length === 0) {
      return NextResponse.json(
        { error: 'Só podes avaliar produtos que compraste e cujo pagamento foi confirmado.' },
        { status: 403 }
      );
    }

    // 1 avaliação por utilizador/produto (UPSERT)
    await sql`
      INSERT INTO reviews (user_id, product_id, rating, comment)
      VALUES (${auth.user.id}, ${productId}, ${rating}, ${comment})
      ON CONFLICT (user_id, product_id)
      DO UPDATE SET rating = ${rating}, comment = ${comment}, created_at = now()
    `;

    // Média atualizada no produto (catálogo/estrelas)
    await sql`
      UPDATE products
      SET rating = (SELECT COALESCE(AVG(rating), 4.5) FROM reviews WHERE product_id = ${productId})
      WHERE id = ${productId}
    `;

    /* ── Anti-burla (Fase 5): reclamações repetidas → supervisão ── */
    if (rating <= 2) {
      const sellerRows = (await sql`
        SELECT user_id FROM products WHERE id = ${productId} AND user_id IS NOT NULL LIMIT 1
      `) as unknown as { user_id: number }[];
      const sellerId = sellerRows[0]?.user_id;
      if (sellerId && sellerId !== auth.user.id) {
        checkSellerComplaints(sellerId).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, message: 'Avaliação registada. Obrigado!' }, { status: 201 });
  } catch (error) {
    console.error('[API /api/reviews] Erro no POST:', error);
    return NextResponse.json(
      { error: 'Não foi possível guardar a avaliação agora.' },
      { status: 503 }
    );
  }
}
