/**
 * AngoStart — Limpeza de dados de teste (users @teste.ao + encomendas órfãs)
 * Executar: DATABASE_URL="postgresql://..." node scripts/cleanup-test-data.js
 */
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    // 1) Encomendas ligadas a utilizadores de teste (FK orders.user_id → users.id)
    const linked = await sql`
      DELETE FROM orders o
      USING users u
      WHERE o.user_id = u.id AND u.email LIKE '%@teste.ao'
      RETURNING o.id`;
    console.log(`🧹 ${linked.length} encomendas de utilizadores de teste removidas.`);

    // 2) Encomendas órfãs antigas (criadas antes da coluna user_id existir)
    const orphan = await sql`DELETE FROM orders WHERE user_id IS NULL RETURNING id`;
    console.log(`🧹 ${orphan.length} encomendas órfãs removidas.`);

    // 3) Utilizadores de teste
    const del = await sql`DELETE FROM users WHERE email LIKE '%@teste.ao' RETURNING email`;
    console.log(`🧹 ${del.length} utilizadores de teste removidos.`);

    const state = await sql`
      SELECT (SELECT COUNT(*)::int FROM users) AS users,
             (SELECT COUNT(*)::int FROM products) AS products,
             (SELECT COUNT(*)::int FROM orders) AS orders`;
    console.log('📊 Estado final:', state[0]);
  } catch (err) {
    console.error('❌ ERRO:', err.message);
    process.exit(1);
  }
})();
