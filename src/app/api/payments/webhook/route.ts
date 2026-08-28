import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyHmacSignature } from '@/lib/security';
import { getEnv } from '@/lib/env';
import { sendPaymentStatusNotification } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/webhook — callback do gateway PayPay (Multicaixa Express).
 *
 * 🔒 SEGURANÇA:
 * - Assinatura HMAC-SHA256 validada (timing-safe) quando PAYPAY_WEBHOOK_SECRET
 *   está configurado — pedidos sem assinatura válida são rejeitados (401).
 * - Sem segredo configurado (modo sandbox), apenas transações criadas em
 *   SIMULAÇÃO (payments.simulated = TRUE) podem ser atualizadas — nunca
 *   dados de produção.
 *
 * Payload esperado: { out_trade_no, trade_status: "pago"|"falhou", trade_no? }
 * (ou trade_status estilo PayPay: TRADE_SUCCESS / TRADE_CLOSED / FINISHED)
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: {
    out_trade_no?: string;
    trade_status?: string;
    trade_no?: string;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const outTradeNo = payload.out_trade_no?.trim();
  if (!outTradeNo) {
    return NextResponse.json({ error: 'out_trade_no é obrigatório.' }, { status: 400 });
  }

  /* ── 1. Verificação de assinatura (produção) / sandbox flag (dev) ── */
  let webhooKSecret: string | undefined;
  try {
    webhooKSecret = getEnv().PAYPAY_WEBHOOK_SECRET;
  } catch {
    return NextResponse.json({ error: 'Ambiente mal configurado.' }, { status: 503 });
  }

  const signature = request.headers.get('x-paypay-signature');
  const simulatedRequest = payload.trade_status === 'SIMULATED';

  if (webhooKSecret) {
    if (!verifyHmacSignature(rawBody, signature, webhooKSecret)) {
      console.warn('[payments/webhook] Assinatura inválida — pedido rejeitado.');
      return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
    }
  } else if (!simulatedRequest) {
    // Sem segredo: só aceitamos confirmações de transações simuladas
    return NextResponse.json(
      { error: 'Webhook de produção exige PAYPAY_WEBHOOK_SECRET configurado.' },
      { status: 401 }
    );
  }

  /* ── 2. Normalização do estado ── */
  const rawStatus = (payload.trade_status ?? '').toUpperCase();
  const successStatuses = ['PAGO', 'TRADE_SUCCESS', 'FINISHED', 'SUCCESS', 'SIMULATED'];
  const failStatuses = ['FALHOU', 'FAILED', 'TRADE_CLOSED', 'CLOSED', 'EXPIRED'];

  let novoEstado: 'pago' | 'falhou' | null = null;
  if (successStatuses.includes(rawStatus)) novoEstado = 'pago';
  else if (failStatuses.includes(rawStatus)) novoEstado = 'falhou';

  if (!novoEstado) {
    return NextResponse.json(
      { ok: true, ignored: true, message: `Estado "${rawStatus}" ignorado.` }
    );
  }

  try {
    /* ── 3. Localizar e atualizar o pagamento ── */
    const payments = (await sql`
      SELECT id, order_id, simulated, status FROM payments
      WHERE out_trade_no = ${outTradeNo}
      LIMIT 1
    `) as unknown as { id: number; order_id: number; simulated: boolean; status: string }[];

    const payment = payments[0];
    if (!payment) {
      return NextResponse.json({ error: 'Transação não encontrada.' }, { status: 404 });
    }
    if (!webhooKSecret && !payment.simulated) {
      return NextResponse.json(
        { error: 'Transação real não pode ser atualizada em modo sandbox.' },
        { status: 403 }
      );
    }

    await sql`
      UPDATE payments
      SET status = ${novoEstado},
          paypay_trade_no = ${payload.trade_no ?? null},
          raw_response = ${rawBody}::jsonb,
          updated_at = now()
      WHERE id = ${payment.id}
    `;

    /* ── 4. Atualizar a encomenda ── */
    const orderStatus = novoEstado === 'pago' ? 'pago' : 'falhou';
    await sql`
      UPDATE orders SET status = ${orderStatus} WHERE id = ${payment.order_id}
    `;

    /* ── 5. Notificar vendedor(es) + admin ── */
    const sellers = (await sql`
      SELECT DISTINCT u.email AS email
      FROM orders o, jsonb_array_elements(o.items) AS it
      LEFT JOIN users u ON u.id = (it->>'seller_id')::integer
      WHERE o.id = ${payment.order_id} AND (it->>'seller_id') IS NOT NULL
    `) as unknown as { email: string | null }[];

    let adminEmail: string | undefined;
    try {
      adminEmail = getEnv().ADMIN_EMAIL;
    } catch {
      adminEmail = undefined;
    }

    try {
      await sendPaymentStatusNotification(
        payment.order_id,
        novoEstado,
        sellers.map((s) => s.email).filter(Boolean) as string[],
        adminEmail
      );
    } catch (emailError) {
      console.error('[payments/webhook] Email falhou (não crítico):', emailError);
    }

    return NextResponse.json({ ok: true, order_id: payment.order_id, status: orderStatus });
  } catch (error) {
    console.error('[payments/webhook] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do webhook.' }, { status: 500 });
  }
}
