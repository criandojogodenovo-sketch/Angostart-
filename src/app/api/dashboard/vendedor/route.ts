import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireSeller } from '@/lib/security';
import { commissionPercentForRole, getBusinessConfig } from '@/lib/config';
import { fuzzCoordinate } from '@/lib/geo';

export const dynamic = 'force-dynamic';

interface SellerOrderRow {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  items: { id: number; name: string; price_kz: number; quantity: number; seller_id: number | null; type?: string }[];
  status: string;
  created_at: string;
  delivery_address?: string | null;
  notes?: string | null;
  service_started_at?: string | null;
  service_completed?: boolean;
  service_completed_at?: string | null;
  tracking_active?: boolean;
  prestador_lat?: number | null;
  prestador_lng?: number | null;
  prestador_loc_updated_at?: string | null;
  // 🔒 Cliente APROXIMADO (fuzz ~500 m) — a posição exata nunca sai do servidor
  client_approx_lat?: number | null;
  client_approx_lng?: number | null;
  client_has_gps?: boolean;
}

/**
 * GET /api/dashboard/vendedor — painel PROFISSIONAL de vendas (Fase 5).
 *
 * KPIs: total de vendas, receita BRUTA, receita LÍQUIDA (após comissão
 * AngoStart configurada em lib/config.ts), comissão retida, número de
 * clientes distintos, avaliação média, atividade recente (pedidos, chat,
 * avaliações) e alertas (reclamações / atividades suspeitas).
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
  const commissionPercent = commissionPercentForRole(auth.user.role, getBusinessConfig());

  try {
    /* Encomendas que contêm artigos do vendedor (evita duplicados por GROUP BY)
     * Inclui campos do fluxo de serviço ao domicílio (rastreamento, morada,
     * conclusão) — a posição do cliente vai sempre FUZZADA (~500 m). */
    const orders = (await sql`
      SELECT o.id, o.customer_name, o.customer_phone, o.customer_email, o.items,
             o.status, o.created_at, o.delivery_address, o.notes,
             o.service_started_at, o.service_completed, o.service_completed_at,
             o.tracking_active, o.prestador_lat, o.prestador_lng,
             o.prestador_loc_updated_at, o.latitude, o.longitude
      FROM orders o
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(o.items) AS it
        WHERE (it->>'seller_id')::integer = ${sellerId}
      )
      ORDER BY o.created_at DESC
      LIMIT 200
    `) as unknown as (SellerOrderRow & {
      latitude: number | null;
      longitude: number | null;
    })[];

    /* 🔒 PRIVACIDADE: aplica o fuzz de 500 m à posição do cliente ANTES de
     * qualquer uso — a coordenada exata é descartada nesta função. */
    for (const o of orders) {
      if (o.latitude != null && o.longitude != null) {
        const f = fuzzCoordinate(o.latitude, o.longitude, o.id);
        o.client_approx_lat = f.lat;
        o.client_approx_lng = f.lng;
        o.client_has_gps = true;
      } else {
        o.client_approx_lat = null;
        o.client_approx_lng = null;
        o.client_has_gps = false;
      }
      o.latitude = null; // sanitização defensiva
      o.longitude = null;
    }

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
    const customers = new Set<string>();

    for (const item of myItems) {
      const subtotal = item.price_kz * item.quantity;
      itemsSold += item.quantity;
      customers.add(item.order.customer_phone);
      if (confirmed.has(item.order.status)) {
        revenueConfirmed += subtotal;
        const month = new Date(item.order.created_at).toISOString().slice(0, 7); // YYYY-MM
        revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + subtotal);
      } else if (item.order.status === 'pendente' || item.order.status === 'aguardando_validacao') {
        revenuePending += subtotal;
      }
      const acc = perProduct.get(item.id) ?? { name: item.name, qty: 0, revenue: 0 };
      acc.qty += item.quantity;
      acc.revenue += subtotal;
      perProduct.set(item.id, acc);
    }

    /* Comissão AngoStart: sobre a receita confirmada, pelo perfil do vendedor */
    const commissionRetained = Math.floor((revenueConfirmed * commissionPercent) / 100);
    const revenueNet = Math.max(revenueConfirmed - commissionRetained, 0);

    /* Avaliação média real (reviews nos produtos do vendedor) */
    const ratingRows = (await sql`
      SELECT COALESCE(AVG(r.rating), 0)::float8 AS avg, count(*)::int AS n
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${sellerId}
    `) as unknown as { avg: number; n: number }[];
    const ratingAverage = Math.round((ratingRows[0]?.avg ?? 0) * 10) / 10;
    const ratingCount = ratingRows[0]?.n ?? 0;

    /* Atividade recente: chat */
    const chatRows = (await sql`
      SELECT count(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE (c.user_id = ${sellerId} OR c.seller_id = ${sellerId})
        AND m.created_at >= now() - interval '7 days'
    `) as unknown as { n: number }[];
    const chatMessages7d = chatRows[0]?.n ?? 0;

    /* Últimas avaliações recebidas */
    const recentReviews = (await sql`
      SELECT r.rating, r.comment, r.created_at, p.name AS product_name, u.name AS client_name
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE p.user_id = ${sellerId}
      ORDER BY r.created_at DESC
      LIMIT 5
    `) as unknown as {
      rating: number;
      comment: string | null;
      created_at: string;
      product_name: string;
      client_name: string | null;
    }[];

    /* Alertas: reclamações (≤2★) e atividades suspeitas abertas */
    const complaintsRows = (await sql`
      SELECT count(*)::int AS n
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${sellerId} AND r.rating <= 2
    `) as unknown as { n: number }[];
    const complaints = complaintsRows[0]?.n ?? 0;

    const suspiciousRows = (await sql`
      SELECT count(*)::int AS n
      FROM suspicious_activities
      WHERE user_id = ${sellerId} AND status = 'aberta'
    `) as unknown as { n: number }[];
    const suspicious = suspiciousRows[0]?.n ?? 0;

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
        .map((i) => ({ name: i.name, price_kz: i.price_kz, quantity: i.quantity, type: i.type ?? null })),
      // ── Fluxo de serviço ao domicílio (rastreamento em tempo real) ──
      delivery_address: o.delivery_address ?? null,
      notes: o.notes ?? null,
      tracking_active: Boolean(o.tracking_active),
      service_started_at: o.service_started_at ?? null,
      service_completed: Boolean(o.service_completed),
      prestador_lat: o.prestador_lat ?? null,
      prestador_lng: o.prestador_lng ?? null,
      prestador_loc_updated_at: o.prestador_loc_updated_at ?? null,
      client_approx_lat: o.client_approx_lat ?? null,
      client_approx_lng: o.client_approx_lng ?? null,
      client_has_gps: Boolean(o.client_has_gps),
    }));

    return NextResponse.json({
      cards: {
        totalOrders: orders.length,
        itemsSold,
        revenueConfirmed,
        revenueNet,
        commissionRetained,
        commissionPercent,
        revenuePending,
        productsPublished: productCount[0]?.n ?? 0,
        clients: customers.size,
        ratingAverage,
        ratingCount,
        chatMessages7d,
        complaints,
        suspicious,
      },
      revenueByMonth: months,
      topProducts,
      recentReviews,
      alerts: {
        complaints: complaints >= 2,
        suspicious: suspicious > 0,
        message:
          suspicious > 0
            ? `Tens ${suspicious} atividade(s) sob monitorização — garante que toda a negociação passa pela plataforma.`
            : complaints >= 2
              ? `${complaints} reclamações de clientes detetadas — responde rápido no chat para recuperar a confiança.`
              : null,
      },
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
