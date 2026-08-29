import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { createPayment, momenuSandbox } from '@/lib/momenu';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/momenu — cria uma intenção de pagamento MoMenu para
 * uma encomenda do utilizador autenticado (Fase 6, ponto 9).
 *
 * 🔒 A rota só funciona se MOMENU_API_KEY estiver definida (senão devolve
 * 503 com mensagem clara — o checkout continua a mostrar apenas KWiK).
 * No modo sandbox (MOMENU_SANDBOX=true) devolve referência simulada, SEM
 * chamada à API real e SEM marcar a encomenda como paga.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para pagar com MoMenu.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'momenu-pay'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { order_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const orderId = Number(body.order_id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, total_kz::float8 AS total_kz, status
      FROM orders WHERE id = ${orderId} LIMIT 1
    `) as unknown as { id: number; user_id: number; total_kz: number; status: string }[];

    const order = rows[0];
    if (!order || order.user_id !== user.id) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }
    if (!['pendente', 'aguardando_validacao'].includes(order.status)) {
      return NextResponse.json(
        { error: 'Esta encomenda já não aceita novos pagamentos.' },
        { status: 400 }
      );
    }

    const result = await createPayment({
      orderId: order.id,
      amountKz: order.total_kz,
      customerPhone: user.telefone ?? '',
      description: `AngoStart — encomenda #${order.id}`,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { ok: true, sandbox: momenuSandbox(), payment: result },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API payments/momenu] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível iniciar o pagamento.' }, { status: 503 });
  }
}
