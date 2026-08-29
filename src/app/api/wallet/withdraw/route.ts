import { NextRequest, NextResponse } from 'next/server';
import {
  requestWithdraw,
  dailyTransactionTotal,
  walletLimits,
  InsufficientFundsError,
} from '@/lib/wallet';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { sendWalletRequestAlert } from '@/lib/email';
import { checkDepositWithdrawLoop } from '@/lib/antifraud';
import { getBusinessConfig, validateAmount } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/wallet/withdraw — pede um saque do saldo disponível.
 *
 * O valor é RESERVADO imediatamente (débito atómico) e enviado manualmente
 * pela equipa via Afrimoney / UNITEL Money para o telefone da conta.
 * Se o admin recusar, o valor volta ao saldo.
 *
 * Fase 5: limites por operação + limite DIÁRIO da configuração central
 * (lib/config.ts) + verificação anti-burla (ciclos depósito→saque).
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

  const config = getBusinessConfig();
  const valor = Math.round(Number(body.valor));
  const check = validateAmount('saque', valor, config);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
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
    /* Limite DIÁRIO: soma dos saques de hoje + este pedido ≤ MAX_DAILY_WITHDRAW */
    const hoje = await dailyTransactionTotal(auth.user.id, 'saque');
    if (hoje + valor > config.maxDailyWithdraw) {
      const restante = Math.max(config.maxDailyWithdraw - hoje, 0);
      return NextResponse.json(
        {
          error:
            `Limite diário de saque (${config.maxDailyWithdraw} Kz) excedido — ` +
            `ainda podes sacar ${restante} Kz hoje. Tenta novamente amanhã.`,
        },
        { status: 400 }
      );
    }

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

    // Anti-burla: ciclos depósito→saque idênticos em 24 h
    checkDepositWithdrawLoop(auth.user.id).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        withdraw: {
          id: withdraw.id,
          referencia: withdraw.referencia,
          valor,
          status: 'pendente',
        },
        limites: walletLimits(),
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

/** GET — limites atuais da carteira (validação em tempo real no cliente). */
export async function GET() {
  return NextResponse.json({ limites: walletLimits() });
}
