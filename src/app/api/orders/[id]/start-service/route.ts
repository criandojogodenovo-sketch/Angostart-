import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/start-service — prestador clica "Iniciar deslocação".
 *
 * Fluxo do serviço ao domicílio (ponto 4B do prompt):
 *   cliente paga (status `pago`) → prestador INICIA o serviço →
 *   tracking_active = true → o dashboard começa a enviar GPS a cada 5 s →
 *   o cliente vê o mapa em tempo real em /perfil.
 *
 * 🔒 SEGURANÇA:
 * - Só o VENDEDOR do item de serviço ao domicílio pode iniciar.
 * - Encomenda tem de estar `pago` (escrow garantido) e não concluída.
 * - Idempotente: iniciar 2× não faz nada de mau (retorna ok).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, 'start-service'), 12, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, status, items, tracking_active, service_completed
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number | null;
      status: string;
      items: { type?: string; seller_id?: number }[];
      tracking_active: boolean;
      service_completed: boolean;
    }[];

    const order = rows[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    // 🔒 Autorização: o prestador tem de ser o vendedor de um item de domicílio
    const isServiceSeller = (order.items ?? []).some(
      (i) => i?.type === 'servico_domicilio' && Number(i?.seller_id) === user.id
    );
    if (!isServiceSeller) {
      return NextResponse.json(
        { error: 'Apenas o prestador deste serviço pode iniciá-lo.' },
        { status: 403 }
      );
    }

    if (order.service_completed) {
      return NextResponse.json(
        { error: 'Este serviço já foi concluído pelo cliente.' },
        { status: 409 }
      );
    }
    if (order.status !== 'pago' && order.status !== 'entregue') {
      return NextResponse.json(
        { error: 'O pagamento ainda não foi validado — o serviço não pode começar.' },
        { status: 409 }
      );
    }

    await sql`
      UPDATE orders
      SET tracking_active = TRUE,
          service_started_at = COALESCE(service_started_at, now())
      WHERE id = ${id}
    `;

    // Notifica o cliente: o prestador está a caminho
    if (order.user_id) {
      await pushNotification(
        order.user_id,
        'Prestador a caminho 🛵',
        `O teu serviço da encomenda #${id} começou — segue a deslocação em tempo real no teu perfil.`,
        '/perfil'
      );
    }

    return NextResponse.json({
      ok: true,
      tracking_active: true,
      service_started_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API orders/start-service] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível iniciar o serviço agora.' },
      { status: 503 }
    );
  }
}
