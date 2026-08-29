import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/proposals/[id] — o prestador aceita ou recusa uma proposta
 * recebida (Fase 6, ponto 12). O cliente pode cancelar uma proposta ainda
 * pendente que ele próprio enviou.
 *
 * Corpo: { action: 'aceite' | 'recusada' | 'cancelada' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para gerir propostas.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'proposals-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const proposalId = Number(id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: 'Proposta inválida.' }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'aceite' && action !== 'recusada' && action !== 'cancelada') {
    return NextResponse.json(
      { error: 'Ação inválida — usa «aceite», «recusada» ou «cancelada».' },
      { status: 400 }
    );
  }

  try {
    const rows = (await sql`
      SELECT id, client_id, provider_id, status FROM proposals WHERE id = ${proposalId} LIMIT 1
    `) as unknown as { id: number; client_id: number; provider_id: number; status: string }[];

    const proposal = rows[0];
    if (!proposal) {
      return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 });
    }
    if (proposal.status !== 'pendente') {
      return NextResponse.json({ error: 'Esta proposta já foi respondida.' }, { status: 409 });
    }

    // Prestador decide; cliente só pode cancelar a própria proposta.
    const isProvider = proposal.provider_id === user.id;
    const isClient = proposal.client_id === user.id;
    if (action === 'cancelada' && !isClient) {
      return NextResponse.json(
        { error: 'Só o autor da proposta a pode cancelar.' },
        { status: 403 }
      );
    }
    if ((action === 'aceite' || action === 'recusada') && !isProvider) {
      return NextResponse.json(
        { error: 'Só o prestador pode aceitar ou recusar propostas.' },
        { status: 403 }
      );
    }

    const updated = (await sql`
      UPDATE proposals
      SET status = ${action}, answered_at = now()
      WHERE id = ${proposalId} AND status = 'pendente'
      RETURNING id, status
    `) as unknown as { id: number; status: string }[];

    if (!updated[0]) {
      return NextResponse.json({ error: 'Esta proposta já foi respondida.' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, status: updated[0].status });
  } catch (error) {
    console.error('[API proposals PATCH] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível responder à proposta.' }, { status: 503 });
  }
}
