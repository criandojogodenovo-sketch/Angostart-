import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireSeller } from '@/lib/security';

export const dynamic = 'force-dynamic';

interface SellerOrderRow {
  id: number;
  customer_name: string;
  customer_phone: string;
  items: { id: number; name: string; price_kz: number; quantity: number; seller_id: number | null }[];
  status: string;
  created_at: string;
}

/**
 * GET /api/dashboard/vendedor — métricas do painel de vendas.
 * 🔒 Apenas vendedores (criador, prestador_domicilio, prestador_remoto).
 * Os valores são calculados APENAS sobre os itens do próprio vendedor
 * (cada item da encomenda guarda seller_id).
 */
export async function GET(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'dashboard'), 60, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const sellerId = auth.user.id;

  try {
    /* Encomendas que contêm artigos do vendedor (evita duplicados por GROUP BY) */
    const orders = (await sql`
      SELECT o.id, o.customer_name, o.customer_phone, o.items, o.status, o.created_at
      FROM orders o
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(o.items) AS it
        WHERE (it->>'seller_id')::integer = ${sellerId}
      )
      ORDER BY o.created_at DESC
      LIMIT 200
    `) as unknown as SellerOrderRow[];

    /* Produtos publicados */
    const productCount = (await sql`
      SELECT count(*)::int AS n FROM products WHERE user_id = ${sellerId}
    `) as unknown as { n: number }[];

    /* ── Agregações (só itens do vendedor) ── */
    const myItems = orders.flatMap((o) =>
      (o.items ?? [])
        .filter((i) => i.seller_id === sellerId)
        .map((i) => ({ ...i, order: o }))
    );

    const confirmed = new Set(['pago', 'entregue']);
    let itemsSold = 0;
    let revenueConfirmed = 0;
    let revenuePending = 0;
    const revenueByMonth = new Map<string, number>();
    const perProduct = new Map<number, { name: string; qty: number; revenue: number }>();

    for (const item of myItems) {
      const subtotal = item.price_kz * item.quantity;
      itemsSold += item.quantity;
      if (confirmed.has(item.order.status)) {
        revenueConfirmed += subtotal;
        const month = new Date(item.order.created_at).toISOString().slice(0, 7); // YYYY-MM
        revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + subtotal);
      } else if (item.order.status === 'pendente') {
        revenuePending += subtotal;
      }
      const acc = perProduct.get(item.id) ?? { name: item.name, qty: 0, revenue: 0 };
      acc.qty += item.quantity;
      acc.revenue += subtotal;
      perProduct.set(item.id, acc);
    }

    /* Últimos 6 meses (inclusive meses sem vendas) */
    const months: { month: string; revenue: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ month: key, revenue: revenueByMonth.get(key) ?? 0 });
    }

    const topProducts = [...perProduct.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
      .map((p) => ({ name: p.name, vendas: p.qty, receita: p.revenue }));

    const ordersList = orders.slice(0, 20).map((o) => ({
      id: o.id,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      status: o.status,
      created_at: o.created_at,
      items: (o.items ?? [])
        .filter((i) => i.seller_id === sellerId)
        .map((i) => ({ name: i.name, price_kz: i.price_kz, quantity: i.quantity })),
    }));

    return NextResponse.json({
      cards: {
        totalOrders: orders.length,
        itemsSold,
        revenueConfirmed,
        revenuePending,
        productsPublished: productCount[0]?.n ?? 0,
      },
      revenueByMonth: months,
      topProducts,
      orders: ordersList,
    });
  } catch (error) {
    console.error('[API dashboard/vendedor] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar as métricas agora.' },
      { status: 503 }
    );
  }
}
