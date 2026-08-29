import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, sanitizeMultiline, requireRole } from '@/lib/security';
import {
  clawbackBlockedEscrowForDispute,
  refundDisputeToBuyer,
  releaseOnDelivered,
} from '@/lib/wallet';
import { sendDisputeDecisionEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/disputes/[id] — resolve uma disputa (Fase 6, ponto 7).
 * 🔒 Admin total ou admin limitado.
 *
 * Corpo: { favor: 'cliente' | 'vendedor', note? }
 *
 * - favor=cliente  → escrow bloqueado é retirado aos vendedores e o valor
 *   total da encomenda é reembolsado à carteira do comprador (idempotente).
 * - favor=vendedor → escrow bloqueado é libertado ao saldo do vendedor.
 *
 * Em ambos os casos o estado da disputa é fechado e as partes recebem email.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ['admin', 'admin_limitado']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-dispute-resolve'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const disputeId = Number(id);
  if (!Number.isInteger(disputeId) || disputeId <= 0) {
    return NextResponse.json({ error: 'Disputa inválida.' }, { status: 400 });
  }

  let body: { favor?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const favor = body.favor === 'cliente' || body.favor === 'vendedor' ? body.favor : null;
  if (!favor) {
    return NextResponse.json(
      { error: 'Indica a decisão: favor = «cliente» ou «vendedor».' },
      { status: 400 }
    );
  }
  const note = sanitizeMultiline(body.note, 1000);

  try {
    const rows = (await sql`
      SELECT d.id, d.order_id, d.user_id AS buyer_id, d.seller_id, d.status,
             o.total_kz::float8 AS total_kz, o.status AS order_status
      FROM disputes d
      JOIN orders o ON o.id = d.order_id
      WHERE d.id = ${disputeId}
      LIMIT 1
    `) as unknown as {
      id: number;
      order_id: number;
      buyer_id: number;
      seller_id: number | null;
      status: string;
      total_kz: number;
      order_status: string;
    }[];

    const dispute = rows[0];
    if (!dispute) {
      return NextResponse.json({ error: 'Disputa não encontrada.' }, { status: 404 });
    }
    if (dispute.status !== 'aberta') {
      return NextResponse.json({ error: 'Esta disputa já foi resolvida.' }, { status: 409 });
    }

    /* ── Efeitos financeiros ── */
    if (favor === 'cliente') {
      // 1. Retira o escrow ainda bloqueado aos vendedores (se houver).
      await clawbackBlockedEscrowForDispute(dispute.order_id);
      // 2. Reembolsa o comprador (idempotente por encomenda).
      await refundDisputeToBuyer(dispute.order_id, dispute.buyer_id, dispute.total_kz);
    } else {
      // Liberta o escrow ao saldo disponível do(s) vendedor(es) (idempotente).
      await releaseOnDelivered(dispute.order_id);
    }

    /* ── Fecha a disputa (atomicamente: só quem atualizar 1 linha ganha) ── */
    const closed = (await sql`
      UPDATE disputes
      SET status = ${favor === 'cliente' ? 'resolvida_cliente' : 'resolvida_vendedor'},
          resolved_by = ${auth.user.id},
          resolved_at = now(),
          resolution = ${note || null}
      WHERE id = ${disputeId} AND status = 'aberta'
      RETURNING id
    `) as unknown as { id: number }[];
    if (!closed[0]) {
      return NextResponse.json({ error: 'Esta disputa já foi resolvida.' }, { status: 409 });
    }

    /* ── Emails às partes (opcionais, nunca bloqueiam a resposta) ── */
    try {
      const parties = (await sql`
        SELECT email FROM users WHERE id IN (${dispute.buyer_id}, ${dispute.seller_id ?? dispute.buyer_id})
      `) as unknown as { email: string }[];
      await Promise.all(
        parties
          .filter((p) => !!p.email)
          .map((p) =>
            sendDisputeDecisionEmail(p.email, dispute.order_id, favor === 'cliente', note)
          )
      );
    } catch {
      /* email opcional */
    }

    return NextResponse.json({
      ok: true,
      status: favor === 'cliente' ? 'resolvida_cliente' : 'resolvida_vendedor',
    });
  } catch (error) {
    console.error('[API admin/disputes PATCH] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível resolver a disputa.' }, { status: 503 });
  }
}
