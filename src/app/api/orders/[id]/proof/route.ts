import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { parseAndValidateProof } from '@/lib/kwik';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/proof — anexa o comprovativo KWiK a uma encomenda
 * já criada (ecrã de confirmação do carrinho).
 *
 * Fluxo: cliente transfere via KWiK → anexa foto/PDF → o pedido passa a
 * status `aguardando_validacao` até um admin aprovar (`pago`) ou rejeitar.
 *
 * 🔒 SEGURANÇA:
 * - Dono autenticado da encomenda OU (encomenda de convidado) telefone que
 *   coincide com o da encomenda.
 * - Comprovativo validado: MIME whitelist, 2 MB máx., magic bytes (ver
 *   lib/kwik.ts) — nada é confiado ao cliente.
 * - Rate limit: 6 uploads / minuto por IP.
 * - Encomendas já validadas (pago/entregue/rejeitado) são recusadas.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'proof-post'), 6, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  let body: { payment_proof?: unknown; payment_proof_name?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const proof = body.payment_proof
    ? parseAndValidateProof({
        dataUrl: body.payment_proof,
        fileName: body.payment_proof_name,
      })
    : null;

  if (!proof) {
    return NextResponse.json(
      { error: 'Comprovativo inválido — usa uma foto (JPG, PNG ou WebP) ou PDF até 2 MB.' },
      { status: 400 }
    );
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, customer_phone, status
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number | null;
      customer_phone: string;
      status: string;
    }[];

    const order = rows[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    /* ── Autorização: dono autenticado ou convidado com o telefone certo ── */
    const user = await getAuthUser(request);
    if (order.user_id !== null) {
      if (!user || user.id !== order.user_id) {
        return NextResponse.json(
          { error: 'Esta encomenda não te pertence.' },
          { status: 403 }
        );
      }
    } else {
      const phoneDigits = String(body.phone ?? '').replace(/\D/g, '');
      const orderDigits = (order.customer_phone ?? '').replace(/\D/g, '');
      if (
        !phoneDigits ||
        phoneDigits.length < 9 ||
        !orderDigits.endsWith(phoneDigits.slice(-9))
      ) {
        return NextResponse.json(
          { error: 'Confirma o número de telefone usado na encomenda.' },
          { status: 403 }
        );
      }
    }

    if (['pago', 'entregue', 'rejeitado', 'falhou'].includes(order.status)) {
      return NextResponse.json(
        { error: 'Esta encomenda já foi validada — cria uma nova encomenda se necessário.' },
        { status: 409 }
      );
    }

    await sql`
      UPDATE orders
      SET payment_method = 'kwik',
          payment_proof = ${proof.dataUrl},
          payment_proof_name = ${proof.name},
          payment_proof_type = ${proof.mime},
          status = 'aguardando_validacao'
      WHERE id = ${id}
    `;

    return NextResponse.json({
      ok: true,
      order: { id, status: 'aguardando_validacao', proof_name: proof.name },
    });
  } catch (error) {
    console.error('[API orders/proof] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível anexar o comprovativo agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
