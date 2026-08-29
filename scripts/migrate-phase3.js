/**
 * AngoStart — Migração Fase 3 (security hardening, maps, admin)
 *
 * - role CHECK passa a incluir 'admin' e 'admin_limitado'
 * - users: + username (único), portfolio_bio, portfolio_image, blocked,
 *          two_factor_secret, two_factor_enabled
 * - products: + service_lat, service_lng (mapa de serviços ao domicílio)
 * - orders: + comprovativo_url (validação de comprovativos no admin)
 * - Novas tabelas: reviews, portfolio_items
 * - ⚠️ Pagamentos: a tabela do antigo gateway foi removida na migração
 *   KWiK (scripts/migrate-kwik.js) — pagamentos são agora manuais.
 *
 * Executar:  env -u DATABASE_URL node --env-file=.env.local scripts/migrate-phase3.js
 */

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  console.log('→ A ligar ao Neon…');

  /* 1. CHECK constraint dos roles (6 perfis) */
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
  await sql`
    ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('cliente', 'criador', 'prestador_domicilio',
                    'prestador_remoto', 'admin', 'admin_limitado'))
  `;
  console.log('✓ users_role_check atualizado (6 perfis)');

  /* 2. Colunas novas em users */
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_bio TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_image TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username)`;
  console.log('✓ users: username, portfolio_bio, portfolio_image, blocked, 2FA');

  /* 3. Backfill de usernames (a partir do email; preserva utilizadores reais) */
  const noUsername = await sql`
    SELECT id, email FROM users WHERE username IS NULL ORDER BY id
  `;
  for (const user of noUsername) {
    let base =
      String(user.email)
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$|\.{2,}/g, '')
        .slice(0, 24)
        .replace(/^\.+|\.+$/g, '') || `utilizador${user.id}`;
    let candidate = base;
    for (let attempt = 0; attempt < 10; attempt++) {
      const exists = await sql`SELECT 1 FROM users WHERE username = ${candidate} LIMIT 1`;
      if (exists.length === 0) break;
      candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    await sql`UPDATE users SET username = ${candidate} WHERE id = ${user.id}`;
    console.log(`  · username "${candidate}" → ${user.email}`);
  }

  /* 4. products: coordenadas de serviço (domicílio) */
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS service_lat DOUBLE PRECISION`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS service_lng DOUBLE PRECISION`;
  console.log('✓ products: service_lat, service_lng');

  /* 5. orders: comprovativo de pagamento */
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS comprovativo_url TEXT`;
  console.log('✓ orders: comprovativo_url');

  /* 6. Tabela reviews (1 avaliação por utilizador/produto) */
  await sql`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, product_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (product_id)`;
  console.log('✓ tabela reviews criada');

  /* 7. Tabela do antigo gateway removida — ver scripts/migrate-kwik.js */
  await sql`DROP TABLE IF EXISTS payments`;
  console.log('✓ tabela do antigo gateway removida (pagamentos são manuais: KWiK)');

  /* 8. Tabela portfolio_items (trabalhos do portfólio público) */
  await sql`
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS portfolio_items_user_idx ON portfolio_items (user_id)`;
  console.log('✓ tabela portfolio_items criada');

  /* 9. Limpeza de dados de exemplo/fictícios (preserva utilizadores reais) */
  await sql`DELETE FROM reviews`;
  await sql`DELETE FROM portfolio_items`;
  await sql`DELETE FROM orders`;
  await sql`DELETE FROM products`;
  const counts = await sql`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM orders) AS orders,
      (SELECT count(*)::int FROM reviews) AS reviews
  `;
  console.log(`✓ limpeza concluída — estado: ${JSON.stringify(counts[0])}`);
  console.log('MIGRAÇÃO FASE 3 CONCLUÍDA ✔');
}

main().catch((error) => {
  console.error('✗ MIGRAÇÃO FALHOU:', error);
  process.exit(1);
});
