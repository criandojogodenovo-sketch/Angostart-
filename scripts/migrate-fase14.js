#!/usr/bin/env node
/**
 * AngoStart — Migração da FASE 14: integração Groq IA.
 *
 * O que faz:
 *  1. users.ai_seller_rating  NUMERIC(4,2) — nota 0-10 dada pela IA
 *     (llama-3.1-8b-instant) à bio do vendedor (batch diário).
 *  2. users.ai_rating_summary TEXT — justificativa curta da nota.
 *  3. users.ai_rated_at       TIMESTAMPTZ — quando foi avaliado (o cron
 *     só reavalia após 7 dias ou se nunca foi avaliado).
 *  4. orders.ai_verification  JSONB — auditoria da verificação VLM de
 *     comprovativos: { extracted, expected, matched, verdict, model, at }.
 *  5. Índice parcial p/ ordenar prestadores/lojas por nota IA.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS).
 *
 * Uso: DATABASE_URL=postgres://… node scripts/migrate-fase14.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida — nunca commitar segredos.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_seller_rating NUMERIC(4,2)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_rating_summary TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_rated_at TIMESTAMPTZ`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS ai_verification JSONB`,
  `CREATE INDEX IF NOT EXISTS idx_users_ai_rating
     ON users (ai_seller_rating DESC NULLS LAST)
     WHERE role IN ('criador','prestador_domicilio','prestador_remoto')
       AND blocked = FALSE`,
];

(async () => {
  console.log('🚀 Fase 14 — migração Groq IA…');
  for (const stmt of STATEMENTS) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await sql.query(stmt);
      console.log(`  ✅ ${label}…`);
    } catch (error) {
      console.error(`  ❌ ${label}…`);
      console.error(error.message);
      process.exit(1);
    }
  }

  /* Verificação final */
  const cols = await sql`
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE (table_name = 'users' AND column_name IN ('ai_seller_rating','ai_rating_summary','ai_rated_at'))
        OR (table_name = 'orders' AND column_name = 'ai_verification')
     ORDER BY table_name, column_name`;
  console.log(
    `\n📦 Colunas Fase 14:`,
    cols.map((c) => `${c.table_name}.${c.column_name}(${c.data_type})`).join(', ')
  );
  console.log('\n🎉 Migração Fase 14 concluída.');
})().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
