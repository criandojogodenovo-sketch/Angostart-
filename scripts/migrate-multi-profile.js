/**
 * AngoStart — Migração multi-perfil (marketplace)
 *
 * O que faz:
 *  1. Limpa os produtos de exemplo (DELETE FROM products)
 *  2. products: remove user_id antigo e recria com FK para users(id); adiciona image_url
 *  3. users: adiciona role, telefone, bio, area_atuacao, cidade, especialidade, portfolio_url
 *     (copia phone → telefone para não perder dados existentes)
 *  4. orders: adiciona user_id (histórico de compras do cliente)
 *
 * Executar: node --env-file=.env.local scripts/migrate-multi-profile.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida. Usa: node --env-file=.env.local scripts/migrate-multi-profile.js');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  // 1) Limpar produtos de exemplo
  `DELETE FROM products`,

  // 2) products: user_id (dono do produto) + image_url
  `ALTER TABLE products DROP COLUMN IF EXISTS user_id`,
  `ALTER TABLE products ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id)`,

  // 3) users: perfis
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'cliente'
     CHECK (role IN ('cliente', 'criador', 'prestador_domicilio', 'prestador_remoto'))`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone TEXT`,
  `UPDATE users SET telefone = phone WHERE telefone IS NULL AND phone IS NOT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS area_atuacao TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS cidade TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS especialidade TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_url TEXT`,

  // 4) orders: ligação ao utilizador (histórico de compras)
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)`,
];

(async () => {
  try {
    console.log('🚀 Migração multi-perfil AngoStart...\n');
    for (const stmt of STATEMENTS) {
      await sql.query(stmt);
      console.log('✅', stmt.replace(/\s+/g, ' ').slice(0, 72) + '…');
    }

    const state = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM users)    AS users,
        (SELECT COUNT(*)::int FROM products) AS products,
        (SELECT COUNT(*)::int FROM orders)   AS orders
    `;
    console.log('\n📊 Estado da base de dados:', state[0]);

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN
        ('role','telefone','bio','area_atuacao','cidade','especialidade','portfolio_url')
      ORDER BY column_name
    `;
    console.log('👤 Colunas de perfil em users:', cols.map((c) => c.column_name).join(', '));
    console.log('\n🎉 Migração concluída com sucesso!');
  } catch (err) {
    console.error('❌ ERRO:', err.message);
    process.exit(1);
  }
})();
