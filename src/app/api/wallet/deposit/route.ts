import { NextRequest, NextResponse } from 'next/server';
import { requestDeposit, dailyTransactionTotal, walletLimits } from '@/lib/wallet';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { sendWalletRequestAlert } from '@/lib/email';
import { checkDepositWithdrawLoop } from '@/lib/antifraud';
import { getBusinessConfig, validateAmount } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/wallet/deposit — pede um depósito na carteira.
 *
 * Fluxo MANUAL (sem gateway): o utilizador indica o valor, recebe uma
 * referência (ex.: AngoStart-DEP-00042) e transfere via Afrimoney /
 * UNITEL Money para o número KWiK da AngoStart. Um admin valida e o
 * saldo entra na carteira. Nada entra no saldo antes da aprovação.
 *
 * Fase 5: limites por operação + limite DIÁRIO (compliance anti-lavagem)
 * vindos da configuração central (lib/config.ts) + verificação anti-burla.
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

  const config = getBusinessConfig();
  const valor = Math.round(Number(body.valor));
  const check = validateAmount('deposito', valor, config);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    /* Limite DIÁRIO: soma dos depósitos de hoje + este pedido ≤ MAX_DAILY_DEPOSIT */
    const hoje = await dailyTransactionTotal(auth.user.id, 'deposito');
    if (hoje + valor > config.maxDailyDeposit) {
      const restante = Math.max(config.maxDailyDeposit - hoje, 0);
      return NextResponse.json(
        {
          error:
            `Limite diário de depósito (${config.maxDailyDeposit} Kz) excedido — ` +
            `ainda podes depositar ${restante} Kz hoje. Tenta novamente amanhã.`,
        },
        { status: 400 }
      );
    }

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

    // Anti-burla: ciclos depósito→saque idênticos em 24 h (não bloqueia o depósito)
    checkDepositWithdrawLoop(auth.user.id).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        deposit: {
          id: deposit.id,
          referencia: deposit.referencia,
          valor,
          status: 'pendente',
        },
        limites: walletLimits(),
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

/** GET — limites atuais da carteira (para validação em tempo real no cliente). */
export async function GET() {
  return NextResponse.json({ limites: walletLimits() });
}
