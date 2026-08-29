import { NextRequest, NextResponse } from 'next/server';
import { requestDeposit, WALLET_MIN_DEPOSIT, WALLET_MAX_DEPOSIT } from '@/lib/wallet';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { sendWalletRequestAlert } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/wallet/deposit — pede um depósito na carteira.
 *
 * Fluxo MANUAL (sem gateway): o utilizador indica o valor, recebe uma
 * referência (ex.: AngoStart-DEP-00042) e transfere via Afrimoney /
 * UNITEL Money para o número KWiK da AngoStart. Um admin valida e o
 * saldo entra na carteira. Nada entra no saldo antes da aprovação.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 6 pedidos de depósito / 5 minutos
  if (!rateLimit(clientKey(request, 'wallet-deposit'), 6, 5 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos de depósito. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: { valor?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const valor = Math.round(Number(body.valor));
  if (!Number.isFinite(valor) || valor < WALLET_MIN_DEPOSIT) {
    return NextResponse.json(
      { error: `O depósito mínimo é ${WALLET_MIN_DEPOSIT} Kz.` },
      { status: 400 }
    );
  }
  if (valor > WALLET_MAX_DEPOSIT) {
    return NextResponse.json(
      { error: `O depósito máximo por pedido é ${WALLET_MAX_DEPOSIT} Kz.` },
      { status: 400 }
    );
  }

  try {
    const deposit = await requestDeposit(auth.user.id, valor);

    // Alerta ao admin (melhor-esforço, não bloqueia)
    try {
      await sendWalletRequestAlert(
        'deposito',
        deposit.referencia,
        valor,
        auth.user.name,
        auth.user.email
      );
    } catch (emailError) {
      console.error('[API wallet/deposit] Alerta falhou (não crítico):', emailError);
    }

    return NextResponse.json(
      {
        ok: true,
        deposit: {
          id: deposit.id,
          referencia: deposit.referencia,
          valor,
          status: 'pendente',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API wallet/deposit] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar o depósito agora.' },
      { status: 503 }
    );
  }
}
