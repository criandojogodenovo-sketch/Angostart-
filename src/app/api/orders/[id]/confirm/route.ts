import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { applyOrderStatusSideEffects } from '@/lib/wallet';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/confirm — cliente confirma a conclusão do serviço
 * ao domicílio ("Confirmar conclusão" em /perfil).
 *
 * 💰 REGRA DE OURO DO ESCROW: o dinheiro SÓ é libertado ao prestador
 * APÓS esta confirmação — nunca antes. Aqui:
 *   1. service_completed = TRUE + tracking parado;
 *   2. status → `entregue`;
 *   3. applyOrderStatusSideEffects('entregue') → releaseOnDelivered()
 *      move o valor de saldo_bloqueado → saldo disponível (idempotente).
 *
 * 🔒 Só o CLIENTE (dono da encomenda) pode confirmar. Encomenda tem de
 * estar `pago`. Chamar 2× não credita 2× (insertOrderTxOnce + guard).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, 'confirm-service'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, status, items, service_completed
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number | null;
      status: string;
      items: { type?: string; name?: string; seller_id?: number }[];
      service_completed: boolean;
    }[];

    const order = rows[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    // 🔒 Apenas o cliente (dono) confirma — o prestador NUNCA pode
    // auto-confirmar o próprio pagamento.
    if (order.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o cliente que contratou o serviço pode confirmar a conclusão.' },
        { status: 403 }
      );
    }

    if (order.service_completed) {
      return NextResponse.json({ ok: true, already_completed: true, status: 'entregue' });
    }

    if (order.status === 'entregue') {
      // Encomenda entregue pelo admin mas flag não marcada — marca e liberta
      await sql`
        UPDATE orders
        SET service_completed = TRUE, service_completed_at = now(), tracking_active = FALSE
        WHERE id = ${id}
      `;
      return NextResponse.json({ ok: true, status: 'entregue' });
    }

    if (order.status !== 'pago') {
      return NextResponse.json(
        {
          error:
            'O pagamento ainda não foi validado — confirma a conclusão apenas depois de o pedido estar pago.',
        },
        { status: 409 }
      );
    }

    // Serviço ao domicílio é o caso de uso; não bloqueamos outros tipos
    // (ex.: serviços remotos também podem ser confirmados pelo cliente).
    await sql`
      UPDATE orders
      SET status = 'entregue',
          service_completed = TRUE,
          service_completed_at = now(),
          tracking_active = FALSE
      WHERE id = ${id} AND service_completed = FALSE
      RETURNING id
    `;

    /* ── 💰 Liberta o escrow: saldo_bloqueado → saldo (idempotente) ── */
    try {
      await applyOrderStatusSideEffects(id, 'pago', 'entregue');
    } catch (walletError) {
      console.error(
        '[API orders/confirm] Libertação do escrow falhou (auditar):',
        walletError
      );
      // A encomenda ficou marcada — o admin pode reprocessar a libertação.
    }

    // Notifica o prestador: dinheiro libertado
    const sellerIds = [
      ...new Set(
        (order.items ?? [])
          .map((i) => Number(i?.seller_id))
          .filter((n) => Number.isInteger(n) && n > 0)
      ),
    ];
    for (const sellerId of sellerIds) {
      await pushNotification(
        sellerId,
        'Serviço confirmado ✓',
        `O cliente confirmou a conclusão da encomenda #${id} — o valor saiu do escrow para o teu saldo disponível.`,
        '/dashboard/vendedor'
      );
    }

    return NextResponse.json({
      ok: true,
      status: 'entregue',
      service_completed: true,
      message: 'Serviço concluído — pagamento libertado ao prestador.',
    });
  } catch (error) {
    console.error('[API orders/confirm] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível confirmar a conclusão agora.' },
      { status: 503 }
    );
  }
}
