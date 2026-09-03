import 'server-only';

/**
 * AngoStart — Fase 21: quotas diárias de IA por utilizador (anti-abuso).
 *
 * Tabela `ai_usage_daily` (user_id, day) com contadores por tipo de uso.
 * Objetivo: NÃO sobrecarregar a API gratuita:
 *   - transcrições de áudio: 3/dia por utilizador
 *   - imagens no chatbot:    10/dia por utilizador (1 por mensagem)
 *   - análises de perfil:    3/dia por utilizador
 *
 * Degradação: se a tabela não existir (migração por correr) ou a BD falhar,
 * devolve `true` (não bloqueia o utilizador) — as quotas são uma proteção
 * de custos, não uma regra de negócio crítica.
 */

import { sql } from '@/lib/db';

export type AiUsageField =
  | 'transcriptions'
  | 'images'
  | 'profile_analyses';

export const AI_USAGE_LIMITS: Record<AiUsageField, number> = {
  transcriptions: 3,
  images: 10,
  profile_analyses: 3,
};

/** Quotas para a UI (número de usos que AINDA restam hoje). */
export async function remainingQuota(
  userId: number,
  field: AiUsageField
): Promise<number> {
  try {
    const rows = (await sql`
      SELECT ${sql.unsafe(field)}::int AS used
        FROM ai_usage_daily
       WHERE user_id = ${userId}
         AND day = (NOW() AT TIME ZONE 'Africa/Luanda')::date
       LIMIT 1
    `) as unknown as { used: number }[];
    const used = rows[0] ? Number(rows[0].used) : 0;
    return Math.max(0, AI_USAGE_LIMITS[field] - used);
  } catch {
    return AI_USAGE_LIMITS[field];
  }
}

/**
 * Consome 1 unidade da quota diária. Devolve `true` se o uso está dentro
 * do limite (e o contador foi incrementado), `false` se excedeu (não
 * incrementa), `true` em degradação (tabela/BD indisponível).
 */
export async function consumeDailyQuota(
  userId: number,
  field: AiUsageField
): Promise<boolean> {
  const column = sql.unsafe(field);
  try {
    const rows = (await sql`
      INSERT INTO ai_usage_daily (user_id, day, ${column})
      VALUES (${userId}, (NOW() AT TIME ZONE 'Africa/Luanda')::date, 1)
      ON CONFLICT (user_id, day)
        DO UPDATE SET ${column} = ai_usage_daily.${column} + 1
      RETURNING ${column}::int AS used
    `) as unknown as { used: number }[];
    if (!rows[0]) return true;
    return Number(rows[0].used) <= AI_USAGE_LIMITS[field];
  } catch (error) {
    console.warn(
      '[lib/ai/usage] quota não registada (degradação aberta):',
      error instanceof Error ? error.message.slice(0, 120) : error
    );
    return true;
  }
}
