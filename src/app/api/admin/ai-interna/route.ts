import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin, clientKey, rateLimit } from '@/lib/security';
import {
  aiTasksStatus,
  callProvider,
  configuredProviders,
  modelFor,
  PROVIDERS,
} from '@/lib/ai/providers';
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
 *   { action: 'ping-providers' }             → diagnóstico ao vivo: 1 chamada
 *                                              mínima (max_tokens 10) a cada
 *                                              provider da cadeia, com status
 *                                              HTTP e corpo EXATO do erro —
 *                                              mostra a causa raiz de um 502
 *                                              (401 chave deprecada, 403
 *                                              geo-block, 429 rate limit…)
 *                                              a partir do IP real da Vercel.
 *
 * Eficiência: reanalyze-proofs é limitado a 5 encomendas por clique e o
 * run-monitor só corre 1×/dia via cron — os botões são para casos pontuais.
 * ping-providers usa timeout de 12 s por provider (máx. 3 na cadeia = 36 s,
 * dentro do maxDuration=60).
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

  /* ── Diagnóstico ao vivo (hotfix 502 set. 2026): ping por provider ──
     Faz UMA chamada mínima a cada provider da cadeia a partir do IP/região
     REAL da Vercel e devolve o status HTTP + corpo exato do erro (com o
     request id do gateway). Chaves nunca são devolvidas — só os NOMES das
     envs. É o teste de curl que o CTO não consegue fazer fora da Vercel. */
  if (action === 'ping-providers') {
    const chain = configuredProviders('text', 'chat');
    const region = process.env.VERCEL_REGION ?? 'local';
    const resultados: {
      provider: string;
      model: string;
      keyEnv: string | null;
      estado: 'ok' | 'erro' | 'sem-chave' | 'reserva';
      ms?: number;
      preview?: string;
      error?: string;
    }[] = [];

    for (const p of PROVIDERS) {
      const entry = chain.find((e) => e.provider.name === p.name);
      if (!entry) {
        /* Fora da cadeia efetiva: sem chave configurada ou reserva. */
        resultados.push({
          provider: p.name,
          model: modelFor(p, 'text') ?? '—',
          keyEnv: p.apiKeyEnv,
          estado: p.inChain === false ? 'reserva' : 'sem-chave',
        });
        continue;
      }
      const t0 = Date.now();
      try {
        const content = await callProvider(
          entry.provider,
          entry.model,
          [
            {
              role: 'system',
              content: 'És um ping de diagnóstico. Responde apenas: OK',
            },
            { role: 'user', content: 'ping' },
          ],
          { maxTokens: 10, temperature: 0 },
          entry.keyEnv,
          12_000
        );
        resultados.push({
          provider: p.name,
          model: entry.model,
          keyEnv: entry.keyEnv,
          estado: 'ok',
          ms: Date.now() - t0,
          preview: content.slice(0, 40),
        });
      } catch (error) {
        resultados.push({
          provider: p.name,
          model: entry.model,
          keyEnv: entry.keyEnv,
          estado: 'erro',
          ms: Date.now() - t0,
          error: (
            error instanceof Error ? error.message : String(error)
          ).slice(0, 300),
        });
      }
    }

    console.warn(
      `[admin/ai-interna] ping-providers região=${region} — ` +
        resultados.map((r) => `${r.provider}:${r.estado}`).join(' ')
    );
    return NextResponse.json({
      ok: true,
      action,
      region,
      resultados,
      nota:
        'Erros incluem o corpo EXATO do provider (com request id do gateway). As chaves nunca são devolvidas.',
    });
  }

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
