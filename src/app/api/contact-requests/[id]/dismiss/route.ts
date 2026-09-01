import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/contact-requests/[id]/dismiss — o CLIENTE descarta o pedido
 * (aceite ou pendente) que já não lhe interessa. Marca como 'cancelada'.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `contact-dismiss:${user.id}`), 30, 10 * 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const requestId = Number(rawId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  try {
    const updated = (await sql`
      UPDATE contact_requests
         SET status = 'cancelada',
             answered_at = NOW(),
             updated_at = NOW()
       WHERE id = ${requestId}
         AND client_id = ${user.id}
         AND status IN ('pendente', 'aceite')
      RETURNING id
    `) as unknown as { id: number }[];

    if (updated.length === 0) {
      return NextResponse.json(
        { error: 'Pedido não encontrado ou já finalizado.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('[API contact-requests dismiss] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível descartar o pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
