/**
 * AngoStart — Limpeza dos dados de teste da Fase 8
 * Remove (por FK-dependency, ordem correta):
 *   wallet_transactions/comissões → orders → products → proposals → users
 * Apenas utilizadores @teste.ao (nunca dados reais).
 * Executar: node --env-file=.env scripts/cleanup-fase8.js
 */
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);

(async () => {
  try {
    // IDs dos utilizadores de teste da F8
    const testUsers = await sql`
      SELECT id FROM users WHERE email LIKE '%@teste.ao'`;
    const ids = testUsers.map((u) => u.id);
    if (ids.length === 0) {
      console.log('Sem utilizadores de teste @teste.ao — nada a limpar.');
      return;
    }
    const idList = ids.join(',');

    // 1) Transações da carteira ligadas a encomendas de teste
    const tx = await sql`
      DELETE FROM wallet_transactions
      WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY(string_to_array(${idList}, ',')::int[])
                          OR items::text ILIKE '%Foto Real F8%')
      RETURNING id`;
    console.log(`🧹 ${tx.length} wallet_transactions removidas.`);

    // 2) Encomendas de teste (por user_id ou contendo produtos de teste)
    const orders = await sql`
      DELETE FROM orders
      WHERE user_id = ANY(string_to_array(${idList}, ',')::int[])
         OR items::text ILIKE '%Foto Real F8%'
      RETURNING id`;
    console.log(`🧹 ${orders.length} encomendas removidas.`);

    // 3) Produtos de teste
    const products = await sql`
      DELETE FROM products WHERE name LIKE 'Foto Real F8%' OR name LIKE 'Imagem Estranha F8%' RETURNING id`;
    console.log(`🧹 ${products.length} produtos removidos.`);

    // 4) Propostas ligadas a produtos removidos (caso existam) — removidas por FK em cascata

    // 5) Badges/pontos dos utilizadores de teste (Fase 7)
    const points = await sql`
      DELETE FROM seller_points WHERE user_id = ANY(string_to_array(${idList}, ',')::int[]) RETURNING user_id`;
    console.log(`🧹 ${points.length} seller_points removidos.`);
    const badges = await sql`
      DELETE FROM user_badges WHERE user_id = ANY(string_to_array(${idList}, ',')::int[]) RETURNING user_id`;
    console.log(`🧹 ${badges.length} user_badges removidos.`);

    // 6) Utilizadores de teste
    const users = await sql`DELETE FROM users WHERE email LIKE '%@teste.ao' RETURNING email`;
    console.log(`🧹 ${users.length} utilizadores de teste removidos.`);

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
