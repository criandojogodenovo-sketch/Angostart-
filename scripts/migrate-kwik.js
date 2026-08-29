/**
 * AngoStart — Migração KWiK (substitui o gateway anterior por pagamento manual)
 *
 * - orders: + payment_method ('kwik' | 'whatsapp'), payment_proof (base64),
 *           payment_proof_name, payment_proof_type, admin_note,
 *           validated_at, validated_by
 * - Remove a tabela `payments` (exclusiva do antigo gateway externo)
 *
 * Executar:  DATABASE_URL='postgres://…' node scripts/migrate-kwik.js
 */

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  console.log('→ A ligar ao Neon…');

  /* 1. Novas colunas de pagamento KWiK em orders */
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'kwik'`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof TEXT`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_name TEXT`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_type TEXT`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_note TEXT`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL`;
  console.log('✓ orders: payment_method, payment_proof(_name/_type), admin_note, validated_at/_by');

  /* 2. Índice para a fila de validação (comprovativos à espera de revisão) */
  await sql`CREATE INDEX IF NOT EXISTS orders_awaiting_idx ON orders (status, created_at DESC)`;

  /* 3. Remover a tabela do antigo gateway (dados de pagamento obsoletos) */
  await sql`DROP TABLE IF EXISTS payments`;
  console.log('✓ tabela payments (antigo gateway) removida');

  const counts = await sql`
    SELECT
      (SELECT count(*)::int FROM orders) AS orders,
      (SELECT count(*)::int FROM orders WHERE payment_proof IS NOT NULL) AS com_comprovativo
  `;
  console.log(`✓ estado: ${JSON.stringify(counts[0])}`);
  console.log('MIGRAÇÃO KWiK CONCLUÍDA ✔');
}

main().catch((error) => {
  console.error('✗ MIGRAÇÃO FALHOU:', error);
  process.exit(1);
});
