#!/usr/bin/env node
/**
 * AngoStart — Migração da FASE 15: palavras-chave (keywords) + anti-spam IA.
 *
 * O que faz:
 *  1. products.keywords             TEXT[] — até 10 palavras-chave por
 *     produto/serviço (busca + ranking; normalizadas lowercase).
 *  2. products.keywords_updated_at  TIMESTAMPTZ — quando as keywords
 *     mudaram (o cron de IA re-analisa perfis com keywords novas).
 *  3. users.keyword_abuse           BOOLEAN — IA marcou keywords que não
 *     correspondem ao produto (anti-manipulação de busca).
 *  4. users.keyword_abuse_detail    TEXT — nota curta da IA (≤200 chars).
 *  5. Índices: GIN em products.keywords (busca em arrays) + parcial em
 *     users.keyword_abuse (fila de revisão admin).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS).
 *
 * Uso: DATABASE_URL=postgres://… node scripts/migrate-fase15.js
 * ⚠️ Nunca commitar a connection string — passa-a inline no terminal.
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida — nunca commitar segredos.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}'`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS keywords_updated_at TIMESTAMPTZ`,
  `UPDATE products SET keywords_updated_at = NOW() WHERE keywords_updated_at IS NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS keyword_abuse BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS keyword_abuse_detail TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_products_keywords
     ON products USING GIN (keywords)`,
  `CREATE INDEX IF NOT EXISTS idx_users_keyword_abuse
     ON users (keyword_abuse)
     WHERE keyword_abuse = TRUE`,
];

(async () => {
  console.log('🚀 Fase 15 — migração keywords + anti-spam IA…');
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
     WHERE (table_name = 'products' AND column_name IN ('keywords','keywords_updated_at'))
        OR (table_name = 'users' AND column_name IN ('keyword_abuse','keyword_abuse_detail'))
     ORDER BY table_name, column_name`;
  console.log(
    `\n📦 Colunas Fase 15:`,
    cols.map((c) => `${c.table_name}.${c.column_name}(${c.data_type})`).join(', ')
  );
  console.log('\n🎉 Migração Fase 15 concluída.');
})().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
