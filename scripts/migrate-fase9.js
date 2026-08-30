/**
 * AngoStart — Migração FASE 9
 * - BI obrigatório + idade mínima (users.birth_date, is_verified_bi, bi_document_url)
 * - Senhas fortes (users.must_change_password para utilizadores antigos)
 * - Afiliados avançados (affiliates.active, total_earnings; affiliate_earnings.product_id)
 * - Lojas virtuais (tabela stores + backfill para vendedores existentes)
 * - Seguir lojas (tabela store_followers)
 * - Avaliações detalhadas (reviews.comunicacao/qualidade/prazo)
 * - Anti-fraude (users.signup_ip, orders.ip_address, users.referred_by)
 *
 * Executar: DATABASE_URL=postgres://... node scripts/migrate-fase9.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida ou inválida.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const DDL = [
  /* ── 1️⃣ BI + idade mínima ─────────────────────────────────────── */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified_bi BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_document_url TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_verified_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_verified_by INTEGER`,

  /* ── 2️⃣ Senhas fortes — utilizadores antigos devem mudar a senha ─ */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,

  /* ── 3️⃣ Afiliados avançados ───────────────────────────────────── */
  `ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS total_earnings NUMERIC NOT NULL DEFAULT 0`,
  `ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE affiliate_earnings ADD COLUMN IF NOT EXISTS product_id INTEGER`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER`,

  /* ── 4️⃣ Lojas virtuais ────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    banner_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stores_owner ON stores(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug)`,
  /* 1 loja por vendedor (exigido pelo ON CONFLICT de getOrCreateStoreForUser) */
  `ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_owner_id_unique`,
  `ALTER TABLE stores ADD CONSTRAINT stores_owner_id_unique UNIQUE (owner_id)`,

  /* ── 5️⃣ Seguir lojas ─────────────────────────────────────────── */
  `CREATE TABLE IF NOT EXISTS store_followers (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_store_followers_store ON store_followers(store_id)`,

  /* ── 5️⃣b Avaliações detalhadas (critérios 1-5, opcionais) ─────── */
  `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comunicacao INTEGER`,
  `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS qualidade INTEGER`,
  `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS prazo INTEGER`,

  /* ── 3️⃣b Anti-fraude: IP de registo + IP do pedido ────────────── */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip_address TEXT`,

  /* Índices de apoio */
  `CREATE INDEX IF NOT EXISTS idx_orders_buyer_paid ON orders(user_id) WHERE status = 'pago'`,
  `CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_affiliate ON affiliate_earnings(affiliate_id)`,
];

/* Vendedores já existentes com BI submetido mantêm a capacidade de
 * publicar — o BI deles já passou pelo gate anterior (Fase 6).
 * Novos vendedores começam is_verified_bi = FALSE e aguardam aprovação. */
const BACKFILL = [
  `UPDATE users SET is_verified_bi = TRUE, kyc_status = 'verified',
     bi_verified_at = NOW()
   WHERE bi_number IS NOT NULL AND is_verified_bi = FALSE`,
  `UPDATE users SET must_change_password = TRUE
   WHERE must_change_password = FALSE AND password_hash IS NOT NULL`,
];

(async () => {
  try {
    console.log('📂 Fase 9 — a aplicar DDL…');
    for (const stmt of DDL) {
      await sql.query(stmt);
    }
    console.log(`✅ ${DDL.length} instruções DDL aplicadas.`);

    /* Backfill: lojas automáticas para vendedores existentes */
    const sellers = await sql`
      SELECT id, name FROM users
      WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
        AND id NOT IN (SELECT owner_id FROM stores)
    `;

    const slugify = (s) =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'loja';

    for (const s of sellers) {
      let slug = slugify(s.name);
      for (let i = 0; i < 50; i += 1) {
        const taken = await sql`SELECT 1 FROM stores WHERE slug = ${slug} LIMIT 1`;
        if (taken.length === 0) break;
        slug = `${slugify(s.name)}-${i + 2}`;
      }
      await sql`INSERT INTO stores (owner_id, name, slug) VALUES (${s.id}, ${s.name}, ${slug})`;
    }
    console.log(`✅ ${sellers.length} lojas criadas para vendedores existentes.`);

    for (const stmt of BACKFILL) {
      await sql.query(stmt);
    }
    console.log('✅ Backfill concluído (BI verificado p/ vendedores antigos · must_change_password=TRUE).');

    const counts = await sql`
      SELECT (SELECT COUNT(*)::int FROM stores) AS stores,
             (SELECT COUNT(*)::int FROM users WHERE must_change_password) AS must_change,
             (SELECT COUNT(*)::int FROM users WHERE is_verified_bi) AS bi_ok
    `;
    console.log('📊 Estado:', counts[0]);
    console.log('🎉 Migração Fase 9 concluída!');
  } catch (err) {
    console.error('❌ ERRO:', err.message);
    process.exit(1);
  }
})();
