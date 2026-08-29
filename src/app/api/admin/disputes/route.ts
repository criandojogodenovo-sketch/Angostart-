import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireRole } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/disputes — lista todas as disputas (Fase 6, ponto 7).
 * 🔒 Admin total ou admin limitado (gestão partilhada).
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ['admin', 'admin_limitado']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-disputes'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  try {
    const rows = (await sql`
      SELECT d.id, d.order_id, d.reason, d.status, d.created_at, d.resolved_at, d.resolution,
             o.total_kz::float8 AS total_kz, o.status AS order_status, o.items,
             buyer.name AS buyer_name, buyer.email AS buyer_email,
             seller.name AS seller_name,
             resolver.name AS resolved_by_name
      FROM disputes d
      JOIN orders o ON o.id = d.order_id
      LEFT JOIN users buyer ON buyer.id = d.user_id
      LEFT JOIN users seller ON seller.id = d.seller_id
      LEFT JOIN users resolver ON resolver.id = d.resolved_by
      ORDER BY d.status = 'aberta' DESC, d.created_at DESC
      LIMIT 100
    `) as unknown as Record<string, unknown>[];

    const disputes = rows.map((r) => ({
      id: Number(r.id),
      order_id: Number(r.order_id),
      reason: String(r.reason ?? ''),
      status: String(r.status ?? 'aberta'),
      created_at: String(r.created_at),
      resolved_at: r.resolved_at ? String(r.resolved_at) : null,
      resolution: (r.resolution as string) ?? null,
      total_kz: Number(r.total_kz ?? 0),
      order_status: String(r.order_status ?? ''),
      items: r.items ?? [],
      buyer_name: (r.buyer_name as string) ?? null,
      buyer_email: (r.buyer_email as string) ?? null,
      seller_name: (r.seller_name as string) ?? null,
      resolved_by_name: (r.resolved_by_name as string) ?? null,
    }));

    return NextResponse.json({ disputes });
  } catch (error) {
    console.error('[API admin/disputes GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as disputas.' }, { status: 503 });
  }
}
