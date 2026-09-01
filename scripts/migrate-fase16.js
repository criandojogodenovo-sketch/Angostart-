/**
 * AngoStart — Migração: Fase 16 (upgrade marketplace estilo Uber/Airbnb).
 *
 * 1. air_orders          — "Pedidos no Ar" (aceitação única estilo Uber)
 * 2. contact_requests    — "Entrar em Contato" (fluxo Airbnb: aceitar/recusar)
 * 3. business_profiles   — Estabelecimentos (lojas, hotéis, empresas) com GPS
 * 4. users.profile_image — foto de perfil distinta do portfolio_image
 *
 * Idempotente: IF NOT EXISTS — pode correr 2× sem efeito.
 * Uso: node scripts/migrate-fase16.js  (lê DATABASE_URL/NEON_DATABASE_URL do .env)
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa)
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
} catch {
  /* .env opcional */
}

const databaseUrl =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
  console.error(
    '❌ Define DATABASE_URL (postgresql://…) antes de correr esta migração.'
  );
  process.exit(1);
}

const sql = neon(databaseUrl);

const STATEMENTS = [
  /* ── 1. Pedidos no Ar (MIXA) — aceitação única estilo Uber ── */
  `CREATE TABLE IF NOT EXISTS air_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'outro',
    title VARCHAR(140) NOT NULL,
    description TEXT NOT NULL,
    budget_kz NUMERIC(12,2) CHECK (budget_kz >= 0),
    cidade VARCHAR(80),
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (provider_id IS NULL OR provider_id <> user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_air_orders_abertos
     ON air_orders(created_at DESC) WHERE status = 'aberto'`,
  `CREATE INDEX IF NOT EXISTS idx_air_orders_user ON air_orders(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_air_orders_provider ON air_orders(provider_id, status)`,

  /* ── 2. Entrar em Contato (fluxo Airbnb) ── */
  `CREATE TABLE IF NOT EXISTS contact_requests (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente',
    conversation_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (client_id <> provider_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contact_requests_provider
     ON contact_requests(provider_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_requests_client
     ON contact_requests(client_id, status)`,

  /* ── 3. Estabelecimentos (lojas, hotéis, empresas) ── */
  `CREATE TABLE IF NOT EXISTS business_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'loja',
    description TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    horario TEXT,
    logo_url TEXT,
    fotos TEXT[] DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_business_profiles_active
     ON business_profiles(active) WHERE active = TRUE`,

  /* ── 4. Foto de perfil (distinta do portfolio_image) ── */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT`,

  /* ── Conversas sem produto (fluxo de contato) — índice de procura ── */
  `CREATE INDEX IF NOT EXISTS idx_conversations_pair
     ON conversations(user_id, seller_id)`,
];

async function main() {
  console.log('🚀 Migração Fase 16 — air_orders, contact_requests, business_profiles, profile_image\n');
  for (const statement of STATEMENTS) {
    const label = statement
      .replace(/\s+/g, ' ')
      .slice(0, 72);
    try {
      // Driver >=1.x: chamada convencional mudou para sql.query()
      await (typeof sql.query === 'function' ? sql.query(statement) : sql(statement));
      console.log(`✅ ${label}…`);
    } catch (error) {
      console.error(`❌ Falhou: ${label}…`);
      console.error(error.message);
      process.exit(1);
    }
  }
  console.log('\n🎉 Migração concluída com sucesso.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
