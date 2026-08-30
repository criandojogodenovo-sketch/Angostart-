#!/usr/bin/env node
/**
 * AngoStart — Migração Fase 11
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Tabela `comments` — comentários livres em produtos, vendedores e lojas
 *    (diferente de reviews: sem estrelas, sem exigência de compra).
 * 2. Correção do bug das "4.5 estrelas": produtos SEM avaliações reais
 *    passam a ter rating = NULL (o INSERT do POST /api/products gravava
 *    4.5 por omissão e o ProductCard mostrava-o como se fosse real).
 * ─────────────────────────────────────────────────────────────────────────
 * Segredos apenas por env (DATABASE_URL). Idempotente.
 */
const { neon } = require('@neondatabase/serverless');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL em falta (exporta antes de correr).');
    process.exit(1);
  }
  const sql = neon(url);

  /* ── 1. Tabela comments ── */
  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('product', 'seller', 'store')),
      target_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_target
      ON comments (target_type, target_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_id)
  `;
  console.log('✓ Tabela comments pronta (com índices)');

  /* ── 2. Rating NULL para produtos sem avaliações reais ──
     A coluna nasceu NOT NULL (com o bug do 4.5 por omissão) — remove-se
     a constraint antes de limpar os ratings falsos. */
  await sql`ALTER TABLE products ALTER COLUMN rating DROP NOT NULL`;
  console.log('✓ Constraint NOT NULL removida de products.rating');

  const before = await sql`
    SELECT count(*)::int AS n FROM products
    WHERE rating IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = products.id)
  `;
  await sql`
    UPDATE products
    SET rating = NULL
    WHERE rating IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = products.id)
  `;
  console.log(
    `✓ Ratings falsos limpos: ${before[0].n} produto(s) sem avaliações agora têm rating = NULL`
  );

  /* ── 3. Confirmação ── */
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'comments'
    ORDER BY ordinal_position
  `;
  console.log(
    '✓ Colunas de comments:',
    cols.map((c) => c.column_name).join(', ')
  );
  console.log('Migração Fase 11 concluída.');
}

main().catch((err) => {
  console.error('✗ Falha na migração:', err.message);
  process.exit(1);
});
