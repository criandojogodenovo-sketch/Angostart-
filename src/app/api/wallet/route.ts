import { NextRequest, NextResponse } from 'next/server';
import { ensureWallet, listWalletTransactions } from '@/lib/wallet';
import { requireRole, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wallet — carteira do utilizador autenticado.
 *
 * 🔒 O saldo vive no servidor e só é exposto aqui, a pedido, com sessão
 * válida (JWT do utilizador OU cookie admin). Nenhum valor de carteira
 * entra no bundle do cliente.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'wallet-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  try {
    const wallet = await ensureWallet(auth.user.id);
    const transactions = await listWalletTransactions(auth.user.id, 30);

    return NextResponse.json({
      saldo: wallet.saldo,
      saldo_bloqueado: wallet.saldo_bloqueado,
      transactions,
    });
  } catch (error) {
    console.error('[API /api/wallet] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar a carteira agora.' },
      { status: 503 }
    );
  }
}
