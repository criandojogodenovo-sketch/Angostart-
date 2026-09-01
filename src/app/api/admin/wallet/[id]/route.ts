import { NextRequest, NextResponse } from 'next/server';
import { decideWalletTransaction } from '@/lib/wallet';
import { requireAdmin, sanitizeText, clientKey, rateLimit } from '@/lib/security';
import { sendWalletDecisionEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/wallet/[id] — decide um depósito/saque pendente.
 * Corpo: { action: 'aprovar' | 'rejeitar' }
 *
 * 🔒 Apenas Admin Total. Depósito aprovado → entra no saldo; saque
 * recusado → valor devolvido ao utilizador. Tudo auditado
 * (processed_by + processed_at).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-wallet-patch'), 30, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const action = sanitizeText(body.action, 20);
  if (action !== 'aprovar' && action !== 'rejeitar') {
    return NextResponse.json(
      { error: 'Ação inválida — usa aprovar ou rejeitar.' },
      { status: 400 }
    );
  }

  try {
    const result = await decideWalletTransaction(
      id,
      action === 'aprovar',
      auth.user.id
    );

    if (!result) {
      return NextResponse.json({ error: 'Operação não encontrada.' }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Esta operação já foi processada.' },
        { status: 409 }
      );
    }

    // Notifica o utilizador (melhor-esforço)
    if (result.user_email) {
      try {
        await sendWalletDecisionEmail(
          result.user_email,
          (result.tipo as 'deposito' | 'saque') ?? 'deposito',
          action === 'aprovar',
          result.valor ?? 0,
          result.referencia ?? `operação n.º ${id}`
        );
      } catch (emailError) {
        console.error('[API admin/wallet/[id]] Email falhou:', emailError);
      }
    }

    return NextResponse.json({
      ok: true,
      decision: action,
      tipo: result.tipo,
    });
  } catch (error) {
    console.error('[API admin/wallet/[id]] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar a operação.' },
      { status: 503 }
    );
  }
}
