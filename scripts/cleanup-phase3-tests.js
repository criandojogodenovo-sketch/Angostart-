/**
 * AngoStart — Limpeza dos dados de teste da auditoria de segurança.
 * Executar: env -u DATABASE_URL node --env-file=.env.local scripts/cleanup-phase3-tests.js
 */

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  const orders = await sql`
    DELETE FROM orders
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-%')
       OR customer_name LIKE 'Cliente Teste%'
       OR customer_name LIKE 'Security Tester%'
    RETURNING id
  `;
  const products = await sql`
    DELETE FROM products
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sec-%')
       OR name LIKE '%Maliciosa%'
    RETURNING id
  `;
  const users = await sql`
    DELETE FROM users WHERE email LIKE 'sec-%' RETURNING email
  `;

  console.log(`✓ encomendas removidas: ${orders.length}`);
  console.log(`✓ produtos removidos: ${products.length}`);
  console.log(`✓ utilizadores de teste removidos: ${users.length}`);

  const counts = await sql`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM orders) AS orders
  `;
  console.log(`estado final: ${JSON.stringify(counts[0])}`);
}

main().catch((error) => {
  console.error('✗ FALHOU:', error.message);
  process.exit(1);
});
