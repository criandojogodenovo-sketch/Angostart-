import { NextRequest, NextResponse } from 'next/server';
import {
  requestWithdraw,
  WALLET_MIN_WITHDRAW,
  WALLET_MAX_WITHDRAW,
  InsufficientFundsError,
} from '@/lib/wallet';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { sendWalletRequestAlert } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/wallet/withdraw — pede um saque do saldo disponível.
 *
 * O valor é RESERVADO imediatamente (débito atómico) e enviado manualmente
 * pela equipa via Afrimoney / UNITEL Money para o telefone da conta.
 * Se o admin recusar, o valor volta ao saldo.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 4 pedidos de saque / 5 minutos
  if (!rateLimit(clientKey(request, 'wallet-withdraw'), 4, 5 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos de saque. Aguarda alguns minutos.' },
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
  if (!Number.isFinite(valor) || valor < WALLET_MIN_WITHDRAW) {
    return NextResponse.json(
      { error: `O saque mínimo é ${WALLET_MIN_WITHDRAW} Kz.` },
      { status: 400 }
    );
  }
  if (valor > WALLET_MAX_WITHDRAW) {
    return NextResponse.json(
      { error: `O saque máximo por pedido é ${WALLET_MAX_WITHDRAW} Kz.` },
      { status: 400 }
    );
  }
  if (!auth.user.telefone || auth.user.telefone.replace(/\D/g, '').length < 9) {
    return NextResponse.json(
      {
        error:
          'Adiciona um telefone válido no teu perfil — é para onde enviamos o dinheiro.',
      },
      { status: 400 }
    );
  }

  try {
    const withdraw = await requestWithdraw(auth.user.id, valor);

    try {
      await sendWalletRequestAlert(
        'saque',
        withdraw.referencia,
        valor,
        auth.user.name,
        auth.user.email
      );
    } catch (emailError) {
      console.error('[API wallet/withdraw] Alerta falhou (não crítico):', emailError);
    }

    return NextResponse.json(
      {
        ok: true,
        withdraw: {
          id: withdraw.id,
          referencia: withdraw.referencia,
          valor,
          status: 'pendente',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json(
        { error: 'Saldo disponível insuficiente para este saque.' },
        { status: 400 }
      );
    }
    console.error('[API wallet/withdraw] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar o saque agora.' },
      { status: 503 }
    );
  }
}
