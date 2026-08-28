import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  clientKey,
  normalizeAngolanPhone,
  rateLimit,
  requireRole,
} from '@/lib/security';
import { createMulticaixaPayment, isPayPayConfigured } from '@/lib/paypay';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments — inicia um pagamento Multicaixa Express (PayPay AO)
 * para uma encomenda existente.
 *
 * 🔒 SERVER-ONLY: as chaves RSA ficam no servidor (lib/paypay.ts lê as
 * variáveis PAYPAY_*); o cliente recebe apenas a referência/estado.
 *
 * Corpo: { order_id, phone }
 * - Valida o telefone angolano (2449XXXXXXXX) e o montante na BD.
 * - Chama createMulticaixaPayment (SDK paypay-ao-sdk).
 * - Regista na tabela payments (pendente) — o webhook atualiza o estado.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'payments-post'), 6, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas de pagamento. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: { order_id?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const orderId = Number(body.order_id);
  const phone = normalizeAngolanPhone(body.phone);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: 'Número Multicaixa inválido — usa um número angolano (ex.: 958 176 915).' },
      { status: 400 }
    );
  }

  try {
    const orders = (await sql`
      SELECT id, total_kz, status, user_id, customer_name
      FROM orders WHERE id = ${orderId} LIMIT 1
    `) as unknown as {
      id: number;
      total_kz: number;
      status: string;
      user_id: number | null;
      customer_name: string;
    }[];

    const order = orders[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }
    // Só o dono da encomenda (ou encomenda de convidado) pode pagar
    if (order.user_id !== null && order.user_id !== auth.user.id) {
      return NextResponse.json(
        { error: 'Esta encomenda não te pertence.' },
        { status: 403 }
      );
    }
    if (order.status === 'pago' || order.status === 'entregue') {
      return NextResponse.json(
        { error: 'Esta encomenda já está paga.' },
        { status: 409 }
      );
    }
    if (order.status === 'rejeitado' || order.status === 'falhou') {
      return NextResponse.json(
        { error: 'Esta encomenda foi rejeitada — cria uma nova encomenda.' },
        { status: 409 }
      );
    }

    const result = await createMulticaixaPayment({
      orderId: order.id,
      amountKz: Number(order.total_kz),
      phone,
      subject: `AngoStart — encomenda #${order.id} (${order.customer_name})`,
    });

    if (result.status === 'falhou') {
      return NextResponse.json({ error: result.message }, { status: 502 });
    }

    await sql`
      INSERT INTO payments (order_id, user_id, amount_kz, phone, method, out_trade_no, paypay_trade_no, status, simulated, raw_response)
      VALUES (
        ${order.id}, ${auth.user.id}, ${Number(order.total_kz)}, ${phone},
        'multicaixa_express', ${result.outTradeNo}, ${result.paypayTradeNo},
        'pendente', ${result.simulated}, ${JSON.stringify(result.raw ?? null)}::jsonb
      )
      ON CONFLICT (out_trade_no) DO UPDATE
        SET status = 'pendente', updated_at = now()
    `;

    return NextResponse.json(
      {
        ok: true,
        payment: {
          order_id: order.id,
          amount_kz: Number(order.total_kz),
          phone,
          reference: result.outTradeNo,
          status: result.status,
          simulated: result.simulated,
          gateway_configured: isPayPayConfigured(),
          message: result.message,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API /api/payments] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível iniciar o pagamento agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}

/** GET /api/payments?order_id= — estado do pagamento de uma encomenda. */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  }
  const orderId = Number(new URL(request.url).searchParams.get('order_id'));
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT p.out_trade_no, p.status, p.amount_kz, p.simulated, p.updated_at, p.paypay_trade_no
      FROM payments p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.order_id = ${orderId}
        AND (o.user_id = ${user.id} OR o.user_id IS NULL)
      ORDER BY p.created_at DESC
      LIMIT 1
    `) as unknown as {
      out_trade_no: string;
      status: string;
      amount_kz: string;
      simulated: boolean;
      updated_at: string;
      paypay_trade_no: string | null;
    }[];

    return NextResponse.json({ payment: rows[0] ?? null });
  } catch (error) {
    console.error('[API /api/payments] Erro no GET:', error);
    return NextResponse.json({ payment: null });
  }
}
