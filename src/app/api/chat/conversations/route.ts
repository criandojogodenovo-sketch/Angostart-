import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

export interface ConversationRow {
  id: number;
  user_id: number;
  seller_id: number;
  product_id: number | null;
  product_name: string | null;
  product_type: string | null;
  last_message: string | null;
  last_message_at: string;
  other_name: string | null;
  other_role: string | null;
  unread?: number;
}

/**
 * GET /api/chat/conversations — lista as conversas do utilizador autenticado
 * (como cliente OU como vendedor/prestador).
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para ver as conversas.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'chat-list'), 60, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  try {
    const rows = (await sql`
      SELECT c.id, c.user_id, c.seller_id, c.product_id, c.last_message_at,
             p.name AS product_name, p.type AS product_type,
             other.name AS other_name, other.role AS other_role,
             (SELECT content FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
      FROM conversations c
      LEFT JOIN products p ON p.id = c.product_id
      LEFT JOIN users other
        ON other.id = CASE WHEN c.user_id = ${user.id} THEN c.seller_id ELSE c.user_id END
      WHERE c.user_id = ${user.id} OR c.seller_id = ${user.id}
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT 50
    `) as unknown as Record<string, unknown>[];

    const conversations = rows.map((r) => ({
      id: Number(r.id),
      user_id: Number(r.user_id),
      seller_id: Number(r.seller_id),
      product_id: r.product_id === null || r.product_id === undefined ? null : Number(r.product_id),
      product_name: (r.product_name as string) ?? null,
      product_type: (r.product_type as string) ?? null,
      other_name: (r.other_name as string) ?? null,
      other_role: (r.other_role as string) ?? null,
      last_message: (r.last_message as string) ?? null,
      last_message_at: String(r.last_message_at),
    }));

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('[API chat/conversations GET] Erro:', error);
    return NextResponse.json({ conversations: [] });
  }
}

/**
 * POST /api/chat/conversations — inicia (ou recupera) uma conversa sobre um
 * produto/serviço. Corpo: { product_id }.
 * Clientes conversam com o vendedor; também permite vendedor iniciar.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para contactar o vendedor.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'chat-start'), 15, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { product_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const productId = Number(body.product_id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  try {
    const products = (await sql`
      SELECT id, user_id FROM products WHERE id = ${productId} LIMIT 1
    `) as unknown as { id: number; user_id: number | null }[];
    const product = products[0];
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    if (!product.user_id) {
      return NextResponse.json(
        { error: 'Este produto não tem vendedor associado — fala connosco pelo WhatsApp.' },
        { status: 400 }
      );
    }
    if (product.user_id === user.id) {
      return NextResponse.json(
        { error: 'Não podes iniciar uma conversa contigo mesmo — este é o teu produto.' },
        { status: 400 }
      );
    }

    const sellerId = product.user_id;
    // Regra de negócio: user_id = comprador/iniciador, seller_id = vendedor
    const buyerId = user.id;

    const inserted = (await sql`
      INSERT INTO conversations (user_id, seller_id, product_id)
      VALUES (${buyerId}, ${sellerId}, ${productId})
      ON CONFLICT (user_id, seller_id, product_id) DO UPDATE SET last_message_at = now()
      RETURNING id, user_id, seller_id, product_id
    `) as unknown as { id: number; user_id: number; seller_id: number; product_id: number }[];

    return NextResponse.json({ ok: true, conversation: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API chat/conversations POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível iniciar a conversa.' }, { status: 503 });
  }
}
