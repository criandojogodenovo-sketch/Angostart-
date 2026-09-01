import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSeller } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/air-orders/[id]/accept — ACEITAÇÃO ÚNICA (estilo Uber).
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🔒 TRANSAÇÃO ATÓMICA — apenas o PRIMEIRO prestador ganha o pedido:
 *
 *   UPDATE air_orders
 *      SET provider_id = …, status = 'aceite', accepted_at = NOW()
 *    WHERE id = … AND status = 'aberto'
 *   RETURNING …
 *
 * O WHERE `status = 'aberto'` é a trava de concorrência: se dois
 * prestadores aceitarem quase em simultâneo, o Postgres serializa os
 * UPDATEs — o primeiro move o estado para 'aceite' (1 linha afetada),
 * o segundo afeta 0 linhas → 409 «Pedido já aceite por outro prestador».
 * ═══════════════════════════════════════════════════════════════════
 *
 * Regras:
 * - Apenas vendedores/prestadores autenticados (requireSeller).
 * - Não se pode aceitar o próprio pedido.
 * - Notifica dono do pedido + prestador (sino + web push).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  // 20 aceitações / 10 minutos por utilizador
  if (!rateLimitAccept(`air-accept:${user.id}`)) {
    return NextResponse.json(
      { error: 'Demasiadas aceitações seguidas. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  try {
    /* ── UPDATE atómico: só afeta a linha se o pedido ainda estiver aberto ── */
    const updated = (await sql`
      UPDATE air_orders
         SET provider_id = ${user.id},
             status = 'aceite',
             accepted_at = NOW(),
             updated_at = NOW()
       WHERE id = ${orderId}
         AND status = 'aberto'
      RETURNING id, user_id, title, budget_kz, cidade
    `) as unknown as {
      id: number;
      user_id: number;
      title: string;
      budget_kz: string | number | null;
      cidade: string | null;
    }[];

    /* ── 0 linhas → o pedido já não está aberto (alguém chegou primeiro,
          ou o dono cancelou, ou não existe) ── */
    if (updated.length === 0) {
      // Distinguir «já aceite» de «não existe» para feedback claro
      const existing = (await sql`
        SELECT status FROM air_orders WHERE id = ${orderId}
      `) as unknown as { status: string }[];

      if (existing.length === 0) {
        return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
      }
      if (existing[0].status === 'aceite') {
        return NextResponse.json(
          { error: 'Pedido já aceite por outro prestador.', code: 'already_accepted' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `Este pedido já não está disponível (estado: ${existing[0].status}).` },
        { status: 409 }
      );
    }

    const order = updated[0];

    // Dono não aceita o próprio pedido (a INSERT já o impede via CHECK
    // provider_id <> user_id, mas damos erro amigável ANTES de notificar)
    if (order.user_id === user.id) {
      // desfazer silenciosamente (não devia acontecer)
      await sql`
        UPDATE air_orders
           SET provider_id = NULL, status = 'aberto', accepted_at = NULL, updated_at = NOW()
         WHERE id = ${orderId}
      `;
      return NextResponse.json(
        { error: 'Não podes aceitar o teu próprio pedido.' },
        { status: 400 }
      );
    }

    /* ── Notificações: dono + prestador (sino + web push, melhor-esforço) ── */
    await pushNotification(
      order.user_id,
      'O teu pedido foi aceite! 🎉',
      `${user.name} aceitou «${order.title}». Combina os detalhes pelo chat.`,
      '/pedidos?tab=meus'
    );
    await pushNotification(
      user.id,
      'Pedido aceite ✓',
      `Aceitaste «${order.title}». O cliente vai receber-te pelo chat.`,
      '/pedidos?tab=aceites'
    );

    return NextResponse.json({ ok: true, order }, { status: 200 });
  } catch (error) {
    // Violação do CHECK provider_id <> user_id (aceitar o próprio pedido)
    const message = error instanceof Error ? error.message : String(error);
    if (/check constraint/i.test(message)) {
      return NextResponse.json(
        { error: 'Não podes aceitar o teu próprio pedido.' },
        { status: 400 }
      );
    }
    console.error('[API air-orders accept] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível aceitar o pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}

/* Rate limit local em memória (por utilizador, chave simples) */
const acceptMap = new Map<string, { count: number; resetAt: number }>();
function rateLimitAccept(key: string): boolean {
  const now = Date.now();
  const entry = acceptMap.get(key);
  if (!entry || entry.resetAt <= now) {
    acceptMap.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}
