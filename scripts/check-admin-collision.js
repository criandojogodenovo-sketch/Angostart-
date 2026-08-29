/** Verifica contas que colidem com o email do admin total. */
const { neon } = require('@neondatabase/serverless');

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const target = (process.env.ADMIN_EMAIL || 'hellyposk@gmail.com').toLowerCase();
  const rows = await sql`
    SELECT id, name, email, role, blocked::boolean AS blocked, created_at
    FROM users WHERE email = ${target} OR role IN ('admin','admin_limitado')
    ORDER BY id
  `;
  for (const r of rows) console.log(r);
  const orders = await sql`
    SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id ORDER BY user_id
  `;
  console.log('pedidos por user_id:', orders);
  const products = await sql`
    SELECT user_id, COUNT(*) AS n FROM products GROUP BY user_id ORDER BY user_id
  `;
  console.log('produtos por user_id:', products);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
