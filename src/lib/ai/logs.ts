import 'server-only';

/**
 * AngoStart — Fase 21: registo de chamadas de IA (auditoria interna).
 *
 * Cada chamada que passa pela cadeia de fallback escreve uma linha em
 * `ai_logs` (tarefa, provider, modelo, resultado, latência, erro). A
 * secção «IA Interna» do painel admin lê esta tabela: chamadas/24h,
 * erros, latência média e últimas execuções.
 *
 * FIRE-AND-FORGET: uma falha de log (tabela ausente, BD em down) NUNCA
 * pode quebrar uma resposta de IA — todos os erros são engolidos com
 * apenas um warn no console do servidor.
 */

import { sql } from '@/lib/db';
import type { AiTask } from './task-routing';

export interface AiCallLog {
  task: AiTask;
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string | null;
}

export async function logAiCall(entry: AiCallLog): Promise<void> {
  try {
    await sql`
      INSERT INTO ai_logs (task, provider, model, ok, latency_ms, error)
      VALUES (${entry.task}, ${entry.provider}, ${entry.model},
              ${entry.ok}, ${Math.round(entry.latencyMs)},
              ${entry.error ? entry.error.slice(0, 300) : null})
    `;
  } catch (error) {
    /* Degradação silenciosa — logging nunca bloqueia a IA. */
    console.warn(
      '[lib/ai/logs] falha ao registar chamada de IA (ignorado):',
      error instanceof Error ? error.message.slice(0, 120) : error
    );
  }
}

/** Estatísticas por tarefa nas últimas 24 h (para o painel admin). */
export interface AiTaskStats {
  task: string;
  calls: number;
  errors: number;
  avg_latency_ms: number | null;
}

export async function aiStats24h(): Promise<AiTaskStats[]> {
  try {
    const rows = (await sql`
      SELECT task,
             count(*)::int AS calls,
             count(*) FILTER (WHERE NOT ok)::int AS errors,
             round(avg(latency_ms))::int AS avg_latency_ms
        FROM ai_logs
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY task
    `) as unknown as AiTaskStats[];
    return rows;
  } catch {
    return [];
  }
}

export interface AiLogRow {
  id: number;
  task: string;
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  created_at: string;
}

/** Últimas execuções (mais recentes primeiro). */
export async function recentAiLogs(limit = 20): Promise<AiLogRow[]> {
  try {
    const rows = (await sql`
      SELECT id, task, provider, model, ok, latency_ms, error,
             created_at::text AS created_at
        FROM ai_logs
       ORDER BY created_at DESC
       LIMIT ${limit}
    `) as unknown as AiLogRow[];
    return rows;
  } catch {
    return [];
  }
}
