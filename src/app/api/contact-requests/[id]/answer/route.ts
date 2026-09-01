import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/contact-requests/[id]/answer — o PRESTADOR responde ao pedido.
 *
 * Body: { action: 'aceite' | 'recusada' }
 *
 * - aceite  → o cliente recebe notificação com botões «Ir para Chat» /
 *             «Descartar». A localização exata SÓ é revelada após o
 *             pagamento (regra Airbnb da plataforma).
 * - recusada → o cliente é notificado de forma neutra.
 *
 * UPDATE atómico com guard de estado: só pendente → aceite/recusada.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `contact-answer:${user.id}`), 30, 10 * 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const requestId = Number(rawId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const action = body.action === 'aceite' ? 'aceite' : body.action === 'recusada' ? 'recusada' : null;
  if (!action) {
    return NextResponse.json({ error: 'Ação inválida — usa aceite ou recusada.' }, { status: 400 });
  }

  try {
    // UPDATE atómico: apenas o prestador destinatário, apenas se pendente
    const updated = (await sql`
      UPDATE contact_requests
         SET status = ${action},
             answered_at = NOW(),
             updated_at = NOW()
       WHERE id = ${requestId}
         AND provider_id = ${user.id}
         AND status = 'pendente'
      RETURNING id, client_id, status
    `) as unknown as { id: number; client_id: number; status: string }[];

    if (updated.length === 0) {
      const existing = (await sql`
        SELECT provider_id, status FROM contact_requests WHERE id = ${requestId}
      `) as unknown as { provider_id: number; status: string }[];
      if (existing.length === 0) {
        return NextResponse.json({ error: 'Pedido de contato não encontrado.' }, { status: 404 });
      }
      if (existing[0].provider_id !== user.id) {
        return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
      }
      return NextResponse.json(
        { error: `Este pedido já foi respondido (estado: ${existing[0].status}).` },
        { status: 409 }
      );
    }

    const row = updated[0];

    if (action === 'aceite') {
      await pushNotification(
        row.client_id,
        'Contacto aceite! 🎉',
        `${user.name} aceitou o teu pedido de contacto — clica em «Ir para Chat» para combinarem os detalhes.`,
        '/pedidos?tab=contactos'
      );
    } else {
      await pushNotification(
        row.client_id,
        'Pedido de contacto indisponível',
        `${user.name} não pode atender o teu pedido neste momento. Explora outros prestadores na plataforma.`,
        '/prestadores'
      );
    }

    return NextResponse.json({ ok: true, status: action }, { status: 200 });
  } catch (error) {
    console.error('[API contact-requests answer] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível responder ao pedido agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
