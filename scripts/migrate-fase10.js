/**
 * AngoStart — Migração FASE 10 (Melhorias de Afiliados — modelo Shopee/Amazon)
 * - Sub-ID / campanha: orders.affiliate_sub_id (código de campanha no checkout)
 * - Sub-ID / campanha: affiliate_earnings.sub_id (relatório de vendas por canal)
 * - (Elegibilidade 5 vendas e escalão 15% @ 50 são apenas código — sem DDL)
 *
 * Executar: DATABASE_URL=postgres://... node scripts/migrate-fase10.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida ou inválida.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const DDL = [
  /* ── 1️⃣ Sub-ID de afiliado na encomenda (ex.: instagram, whatsapp) ── */
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_sub_id TEXT`,

  /* ── 2️⃣ Sub-ID na comissão — permite relatório de performance por canal ── */
  `ALTER TABLE affiliate_earnings ADD COLUMN IF NOT EXISTS sub_id TEXT`,
];

(async () => {
  try {
    let done = 0;
    for (const stmt of DDL) {
      await sql.query(stmt);
      done += 1;
      console.log(`  ✓ ${stmt.slice(0, 72).replace(/\s+/g, ' ')}…`);
    }
    console.log(`\n✅ Migração Fase 10 concluída — ${done}/${DDL.length} instruções aplicadas.`);
  } catch (error) {
    console.error('❌ Erro na migração Fase 10:', error.message);
    process.exit(1);
  }
})();
