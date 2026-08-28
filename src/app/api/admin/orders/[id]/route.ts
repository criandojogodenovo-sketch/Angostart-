import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin } from '@/lib/security';
import { sendOrderValidatedEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const ALLOWED = new Map([
  ['pago', 'pago'],
  ['entregue', 'entregue'],
  ['rejeitado', 'rejeitado'],
  ['falhou', 'falhou'],
]);

/**
 * PATCH /api/admin/orders/[id] — valida comprovativo:
 * Aprovar → status 'pago' (cliente notificado).
 * Rejeitar → status 'rejeitado'.
 * 🔒 admin + admin_limitado (apenas validação).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const nextStatus = ALLOWED.get(body.status ?? '');
  if (!nextStatus) {
    return NextResponse.json(
      { error: 'Estado inválido — usa pago, entregue, rejeitado ou falhou.' },
      { status: 400 }
    );
  }

  try {
    const updated = (await sql`
      UPDATE orders SET status = ${nextStatus} WHERE id = ${id}
      RETURNING id, customer_email, status
    `) as unknown as { id: number; customer_email: string | null; status: string }[];

    if (!updated[0]) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    try {
      await sendOrderValidatedEmail(updated[0].id, updated[0].customer_email, nextStatus === 'pago' || nextStatus === 'entregue');
    } catch (emailError) {
      console.error('[API admin/orders/[id]] Email falhou (não crítico):', emailError);
    }

    return NextResponse.json({ ok: true, order: updated[0] });
  } catch (error) {
    console.error('[API admin/orders/[id]] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível atualizar a encomenda.' }, { status: 503 });
  }
}
