import { NextRequest, NextResponse } from 'next/server';
import { runGamificationCron } from '@/lib/gamification-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/gamification — tarefa agendada (Vercel Cron, diária):
 * reavalia os selos automáticos de todos os vendedores (vendas_100,
 * avaliacao_5, criador_infoprodutos, prestador_domicilio, freelancer_top)
 * e, no 1.º dia do mês, atribui «Top Vendedor do Mês».
 *
 * 🔒 Proteção: `Authorization: Bearer $CRON_SECRET` (igual ao daily-codes).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (cronSecret) {
    if (bearer !== cronSecret) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET não configurada — cron desativado em produção.' },
      { status: 403 }
    );
  }

  try {
    const result = await runGamificationCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[API cron/gamification] Erro:', error);
    return NextResponse.json({ error: 'Falha na avaliação de selos.' }, { status: 503 });
  }
}
