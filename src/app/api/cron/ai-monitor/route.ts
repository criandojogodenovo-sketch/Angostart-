import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET/POST /api/cron/ai-monitor — Fase 21: lote diário de monitorização IA.
 *
 * 🔒 Proteção: `Authorization: Bearer $CRON_SECRET` (igual aos outros crons).
 * Agendamento (vercel.json): 45 4 * * * — 04:45 UTC (05:45 Luanda), antes
 * do ai-rate-sellers (05:15 UTC) para não competir pela API.
 *
 * Eficiência: UMA chamada de IA por dia (tarefa 'monitor' → Qwen3.8-Flash);
 * se a IA falhar, heurística local continua a produzir alertas mínimos.
 */

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET não configurada — cron desativado em produção.' },
      { status: 503 }
    );
  }
  const bearer = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!bearer || bearer !== cronSecret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const { runAiMonitorBatch } = await import('@/lib/ai-monitor');
  const result = await runAiMonitorBatch();

  console.log('[cron/ai-monitor]', JSON.stringify(result));
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
