import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin, sanitizeMultiline } from '@/lib/security';
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
 * PATCH /api/admin/orders/[id] — valida comprovativo KWiK:
 * Aprovar → status 'pago' (cliente notificado por email).
 * Rejeitar → status 'rejeitado'.
 * Aceita ainda `admin_note` (observação interna da validação).
 *
 * 🔒 admin + admin_limitado (apenas validação). Cada decisão fica
 * auditada: validated_at + validated_by.
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

  let body: { status?: string; admin_note?: unknown };
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

  const adminNote = body.admin_note
    ? sanitizeMultiline(String(body.admin_note), 300) || null
    : null;

  try {
    const updated = (await sql`
      UPDATE orders
      SET status = ${nextStatus},
          admin_note = ${adminNote},
          validated_at = now(),
          validated_by = ${auth.user.id}
      WHERE id = ${id}
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
