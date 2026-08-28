import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders?status=pendente — encomendas para validação
 * de comprovativos.
 * 🔒 admin + admin_limitado (o limitado vê APENAS isto — sem utilizadores
 * nem produtos). Por omissão devolve as pendentes.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const statusParam = new URL(request.url).searchParams.get('status');
  const status = ['pendente', 'pago', 'falhou', 'rejeitado', 'entregue'].includes(statusParam ?? '')
    ? statusParam!
    : 'pendente';

  try {
    const orders = (await sql`
      SELECT id, customer_name, customer_phone, customer_email, items, total_kz,
             status, delivery_type, notes, comprovativo_url, created_at
      FROM orders
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT 100
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[API admin/orders] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível listar as encomendas.' }, { status: 503 });
  }
}
