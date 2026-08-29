import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/report — relatório de desempenho da plataforma (Fase 5).
 * 🔒 Apenas admin total.
 *
 * Devolve: utilizadores registados (por perfil), produtos ativos, receita
 * mensal (6 meses), encomendas por estado, comissões da plataforma.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-report'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  try {
    const usersByRole = (await sql`
      SELECT role, count(*)::int AS n
      FROM users WHERE blocked = FALSE
      GROUP BY role ORDER BY n DESC
    `) as unknown as { role: string; n: number }[];

    const productStats = (await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_hot)::int AS hot,
             count(DISTINCT user_id)::int AS sellers
      FROM products
    `) as unknown as { total: number; hot: number; sellers: number }[];

    const ordersByStatus = (await sql`
      SELECT status, count(*)::int AS n, COALESCE(SUM(total_kz), 0)::float8 AS volume
      FROM orders GROUP BY status
    `) as unknown as { status: string; n: number; volume: number }[];

    /* Receita mensal (encomendas pagas/entregues) — últimos 6 meses */
    const monthly = (await sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
             count(*)::int AS orders,
             COALESCE(SUM(total_kz), 0)::float8 AS revenue,
             COALESCE(SUM(platform_commission_kz), 0)::float8 AS commission
      FROM orders
      WHERE status IN ('pago', 'entregue')
        AND created_at >= date_trunc('month', now()) - interval '5 months'
      GROUP BY 1 ORDER BY 1
    `) as unknown as { month: string; orders: number; revenue: number; commission: number }[];

    const totals = (await sql`
      SELECT COALESCE(SUM(total_kz), 0)::float8 AS revenue,
             COALESCE(SUM(platform_commission_kz), 0)::float8 AS commission
      FROM orders WHERE status IN ('pago', 'entregue')
    `) as unknown as { revenue: number; commission: number }[];

    const newUsers30d = (await sql`
      SELECT count(*)::int AS n FROM users
      WHERE created_at >= now() - interval '30 days'
    `) as unknown as { n: number }[];

    return NextResponse.json({
      usersByRole,
      products: {
        total: Number(productStats[0]?.total ?? 0),
        hot: Number(productStats[0]?.hot ?? 0),
        activeSellers: Number(productStats[0]?.sellers ?? 0),
      },
      ordersByStatus,
      monthly,
      totals: {
        revenue: Number(totals[0]?.revenue ?? 0),
        commission: Number(totals[0]?.commission ?? 0),
        newUsers30d: Number(newUsers30d[0]?.n ?? 0),
      },
    });
  } catch (error) {
    console.error('[API admin/report GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível gerar o relatório.' }, { status: 503 });
  }
}
