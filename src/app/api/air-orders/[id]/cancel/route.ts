import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/air-orders/[id]/cancel — o DONO cancela o pedido.
 *
 * - «aberto»  → cancela diretamente.
 * - «aceite»  → cancela e notifica o prestador de que ficou livre.
 * - outros    → 409 (não se cancela o que já concluiu/cancelou).
 *
 * Apenas o dono (user_id) pode cancelar — 403 para os restantes.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, `air-cancel:${user.id}`), 20, 10 * 60_000)) {
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
    // UPDATE atómico: só o dono, só estados canceláveis
    const updated = (await sql`
      UPDATE air_orders
         SET status = 'cancelado',
             cancelled_at = NOW(),
             updated_at = NOW()
       WHERE id = ${orderId}
         AND user_id = ${user.id}
         AND status IN ('aberto', 'aceite')
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
          { error: 'Apenas quem publicou o pedido o pode cancelar.' },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: `O pedido está «${existing[0].status}» — já não pode ser cancelado.` },
        { status: 409 }
      );
    }

    const order = updated[0];

    // Se havia prestador com o pedido na mão, avisa-o (melhor-esforço)
    if (order.provider_id) {
      await pushNotification(
        order.provider_id,
        'Pedido cancelado pelo cliente',
        `O cliente cancelou «${order.title}». Não será necessário deslocar-te.`,
        '/pedidos'
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('[API air-orders cancel] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível cancelar o pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
