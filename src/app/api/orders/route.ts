import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface OrderItemPayload {
  id: number;
  name: string;
  price_kz: number;
  quantity: number;
}

interface OrderPayload {
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  items?: OrderItemPayload[];
  delivery_type?: string;
  notes?: string;
}

/**
 * POST /api/orders — Regista uma encomenda no Neon.
 * Corpo: { customer_name, customer_phone, customer_email?, items[], delivery_type?, notes? }
 */
export async function POST(request: NextRequest) {
  let body: OrderPayload;

  try {
    body = (await request.json()) as OrderPayload;
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const { customer_name, customer_phone, customer_email, items, delivery_type, notes } = body;

  if (!customer_name || customer_name.trim().length < 3) {
    return NextResponse.json(
      { error: 'Indica o teu nome completo (mínimo 3 letras).' },
      { status: 400 }
    );
  }
  if (!customer_phone || customer_phone.trim().length < 9) {
    return NextResponse.json(
      { error: 'Indica um número de telefone válido (mínimo 9 dígitos).' },
      { status: 400 }
    );
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: 'O carrinho está vazio — adiciona pelo menos um produto.' },
      { status: 400 }
    );
  }

  const totalKz = items.reduce(
    (acc, item) =>
      acc + (Number.isFinite(item.price_kz) ? item.price_kz : 0) * (Number.isFinite(item.quantity) ? item.quantity : 0),
    0
  );

  if (totalKz <= 0) {
    return NextResponse.json(
      { error: 'Total da encomenda inválido.' },
      { status: 400 }
    );
  }

  try {
    const inserted = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, notes)
      VALUES (
        ${customer_name.trim()},
        ${customer_phone.trim()},
        ${customer_email?.trim() || null},
        ${JSON.stringify(items)}::jsonb,
        ${totalKz},
        'pendente',
        ${delivery_type || 'retirada'},
        ${notes?.trim() || null}
      )
      RETURNING id, created_at, total_kz, status
    `);

    const order = inserted[0];

    return NextResponse.json(
      {
        ok: true,
        order: {
          id: order.id,
          created_at: order.created_at,
          total_kz: order.total_kz,
          status: order.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API /api/orders] Erro no Neon:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar a encomenda agora. Tenta novamente ou fala connosco pelo WhatsApp.' },
      { status: 503 }
    );
  }
}

/**
 * GET /api/orders — Lista as últimas encomendas (uso interno/admin).
 */
export async function GET() {
  try {
    const rows = await sql`
      SELECT id, customer_name, total_kz, status, created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ orders: rows });
  } catch (error) {
    console.error('[API /api/orders] Erro ao listar:', error);
    return NextResponse.json({ orders: [] }, { status: 200 });
  }
}
