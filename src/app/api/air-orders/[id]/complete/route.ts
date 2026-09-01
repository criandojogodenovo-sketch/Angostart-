import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/air-orders/[id]/complete — o DONO marca o pedido como concluído
 * (trabalho executado e validado). Notifica o prestador e é usado como
 * métrica de reputação no marketplace.
 *
 * Apenas o dono, apenas a partir de «aceite» — idempotente (409 se repetido).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, `air-complete:${user.id}`), 20, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas operações seguidas. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  try {
    const updated = (await sql`
      UPDATE air_orders
         SET status = 'concluido',
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${orderId}
         AND user_id = ${user.id}
         AND status = 'aceite'
      RETURNING id, provider_id, title
    `) as unknown as { id: number; provider_id: number | null; title: string }[];

    if (updated.length === 0) {
      const existing = (await sql`
        SELECT user_id, status FROM air_orders WHERE id = ${orderId}
      `) as unknown as { user_id: number; status: string }[];

      if (existing.length === 0) {
        return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
      }
      if (existing[0].user_id !== user.id) {
        return NextResponse.json(
          { error: 'Apenas quem publicou o pedido o pode marcar como concluído.' },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: `O pedido está «${existing[0].status}» — só pedidos aceites podem ser concluídos.` },
        { status: 409 }
      );
    }

    const order = updated[0];

    if (order.provider_id) {
      await pushNotification(
        order.provider_id,
        'Pedido concluído ✓',
        `O cliente confirmou a conclusão de «${order.title}». Bom trabalho!`,
        '/pedidos?tab=aceites'
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('[API air-orders complete] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível concluir o pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
