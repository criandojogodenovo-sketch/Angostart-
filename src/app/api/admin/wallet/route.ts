import { NextRequest, NextResponse } from 'next/server';
import { listPendingWalletOps } from '@/lib/wallet';
import { requireAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/wallet — fila de depósitos e saques pendentes.
 *
 * 🔒 Apenas Admin Total (movimentação de dinheiro). Os valores são
 * recalculados no servidor; nenhum segredo é exposto.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const ops = await listPendingWalletOps(60);
    return NextResponse.json({ ops });
  } catch (error) {
    console.error('[API admin/wallet] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar a fila da carteira.' },
      { status: 503 }
    );
  }
}
