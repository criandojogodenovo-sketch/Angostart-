import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin, clientKey, rateLimit } from '@/lib/security';
import { aiTasksStatus } from '@/lib/ai/providers';
import { aiStats24h, recentAiLogs } from '@/lib/ai/logs';
import { runAiMonitorBatch } from '@/lib/ai-monitor';
import { verifyOrderProof } from '@/lib/ai-proof';
import { sanitizeText } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * /api/admin/ai-interna — Fase 21: secção «IA Interna» do painel admin.
 *
 * GET — estado completo (🔒 apenas admin):
 *   - tasks: modelo + chave dedicada/emergência por tarefa (chat/vision/monitor)
 *   - stats24h: chamadas, erros e latência média por tarefa (ai_logs)
 *   - logs: últimas 20 execuções
 *   - monitor: alertas abertos da monitorização IA + contagens por estado
 *
 * POST — ações (🔒 apenas admin):
 *   { action: 'run-monitor' }                → força o lote de monitorização
 *   { action: 'reanalyze-proofs' }           → re-analisa até 5 comprovativos
 *                                              pendentes (aguardando_validacao)
 *   { action: 'triage', id, estado }         → ignora/resolve um alerta
 *
 * Eficiência: reanalyze-proofs é limitado a 5 encomendas por clique e o
 * run-monitor só corre 1×/dia via cron — os botões são para casos pontuais.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'ai-interna'), 60, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  try {
    const [tasks, stats, logs] = [
      aiTasksStatus(),
      await aiStats24h(),
      await recentAiLogs(20),
    ];

    let alerts: unknown[] = [];
    const counts: Record<string, number> = {};
    try {
      alerts = (await sql`
        SELECT a.id, a.kind, a.severity, a.entity_type, a.entity_id,
               a.related_entity_id, a.excerpt, a.reason, a.model,
               a.status, a.created_at::text AS created_at
          FROM ai_monitor_alerts a
         WHERE a.status = 'aberta'
         ORDER BY
           CASE a.severity WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
           a.created_at DESC
         LIMIT 50
      `) as unknown[];
      const countRows = (await sql`
        SELECT status, count(*)::int AS n
          FROM ai_monitor_alerts
         GROUP BY status
      `) as unknown as { status: string; n: number }[];
      for (const r of countRows) counts[r.status] = Number(r.n);
    } catch (error) {
      console.error('[admin/ai-interna] monitor alerts:', error);
    }

    return NextResponse.json({
      tasks,
      stats24h: stats,
      logs,
      monitor: { alerts, counts },
    });
  } catch (error) {
    console.error('[API admin/ai-interna GET] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar o estado da IA.' },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'ai-interna-post'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas ações seguidas — aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: { action?: unknown; id?: unknown; estado?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const action = sanitizeText(body.action, 30);

  /* ── Forçar lote de monitorização ── */
  if (action === 'run-monitor') {
    const result = await runAiMonitorBatch();
    return NextResponse.json({ ok: true, action, monitor: result });
  }

  /* ── Re-analisar comprovativos pendentes (máx. 5 por clique) ── */
  if (action === 'reanalyze-proofs') {
    try {
      const rows = (await sql`
        SELECT id, payment_proof
          FROM orders
         WHERE status = 'aguardando_validacao'
           AND payment_proof IS NOT NULL
         ORDER BY updated_at ASC
         LIMIT 5
      `) as unknown as { id: number; payment_proof: string }[];

      const resultados: {
        order_id: number;
        ok: boolean;
        verdict?: string;
        auto_approved?: boolean;
        error?: string;
      }[] = [];
      for (const row of rows) {
        const r = await verifyOrderProof(row.id, row.payment_proof);
        if (r.ok) {
          resultados.push({
            order_id: row.id,
            ok: true,
            verdict: r.verdict.verdict,
            auto_approved: r.autoApproved,
          });
        } else {
          resultados.push({ order_id: row.id, ok: false, error: r.error });
        }
      }
      return NextResponse.json({ ok: true, action, analisados: resultados });
    } catch (error) {
      console.error('[API admin/ai-interna reanalyze-proofs] Erro:', error);
      return NextResponse.json(
        { error: 'Falha ao re-analisar comprovativos.' },
        { status: 502 }
      );
    }
  }

  /* ── Triagem de um alerta ── */
  if (action === 'triage') {
    const id = Number(body.id);
    const estado = sanitizeText(body.estado, 20);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Alerta inválido.' }, { status: 400 });
    }
    if (!['ignorada', 'resolvida'].includes(estado)) {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
    }
    try {
      const updated = (await sql`
        UPDATE ai_monitor_alerts
           SET status = ${estado}
         WHERE id = ${id}
        RETURNING id
      `) as unknown as { id: number }[];
      if (!updated[0]) {
        return NextResponse.json({ error: 'Alerta não encontrado.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id, estado });
    } catch (error) {
      console.error('[API admin/ai-interna triage] Erro:', error);
      return NextResponse.json({ error: 'Falha ao atualizar o alerta.' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
