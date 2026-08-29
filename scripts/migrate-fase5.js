/**
 * AngoStart — Migração Fase 5
 *
 * 1. products.file_url          — PDF de infoprodutos (Vercel Blob)
 * 2. users.whatsapp_contact     — contacto WhatsApp dos admins limitados
 * 3. users.latitude/longitude   — disponibilidade do prestador (mapa)
 * 4. users.bi_number/nif_number/kyc_status — KYC simples
 * 5. orders.latitude/longitude  — localização do cliente no checkout (domicílio)
 * 6. wallet_transactions.commission_kz — comissão AngoStart retida por venda
 * 7. announcements              — anúncios/promoções por perfil
 * 8. conversations + messages   — chat interno cliente ↔ vendedor
 * 9. suspicious_activities      — anti-burla / monitorização
 * 10. password_resets           — recuperação de senha por email
 * 11. notifications             — sino de notificações no site
 *
 * Executar:  node --env-file=.env scripts/migrate-fase5.js
 */

const { neon } = require('@neondatabase/serverless');

/** O sandbox pode exportar DATABASE_URL com formato file: — usa NEON_ se válida. */
function dbUrl() {
  const candidates = [process.env.NEON_DATABASE_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    if (c && c.startsWith('postgres')) return c;
  }
  throw new Error('DATABASE_URL/NEON_DATABASE_URL inválida — verifica o ficheiro .env');
}

async function main() {
  const sql = neon(dbUrl());
  console.log('→ A ligar ao Neon…');

  /* 1. PDF de infoprodutos */
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS file_url TEXT`;
  console.log('✓ products: file_url TEXT');

  /* 2. WhatsApp contact (admins limitados — gerido no painel admin) */
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_contact TEXT`;
  console.log('✓ users: whatsapp_contact TEXT');

  /* 3. Localização do prestador (botão "Estou disponível") */
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ`;
  console.log('✓ users: latitude, longitude, available_until');

  /* 4. KYC simples (BI / NIF) */
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_number TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS nif_number TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'none'`;
  console.log("✓ users: bi_number, nif_number, kyc_status DEFAULT 'none'");

  /* 5. Localização do cliente na encomenda (serviços ao domicílio) */
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`;
  console.log('✓ orders: latitude, longitude');

  /* 6. Comissão AngoStart retida por movimentação (auditoria) */
  await sql`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS commission_kz NUMERIC(12,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_commission_kz NUMERIC(12,2) NOT NULL DEFAULT 0`;
  console.log('✓ wallet_transactions.commission_kz + orders.platform_commission_kz');

  /* 7. Anúncios / promoções */
  await sql`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'novidade',
      target_role TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (active, created_at DESC)`;
  console.log('✓ announcements (promo | destaque | novidade | exclusivo)');

  /* 8. Chat interno */
  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, seller_id, product_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, last_message_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations (seller_id, last_message_at DESC)`;
  console.log('✓ conversations + messages');

  /* 9. Anti-burla / monitorização */
  await sql`
    CREATE TABLE IF NOT EXISTS suspicious_activities (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT,
      severity TEXT NOT NULL DEFAULT 'media',
      status TEXT NOT NULL DEFAULT 'aberta',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_by INTEGER REFERENCES users(id),
      processed_at TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_suspicious_status ON suspicious_activities (status, created_at DESC)`;
  console.log("✓ suspicious_activities (status: aberta | ignorada | resolvida)");

  /* 10. Recuperação de senha */
  await sql`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, expires_at)`;
  console.log('✓ password_resets');

  /* 11. Sino de notificações */
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at DESC)`;
  console.log('✓ notifications');

  /* ── Verificação final ── */
  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('announcements','conversations','messages',
                         'suspicious_activities','password_resets','notifications')
    ORDER BY table_name
  `);
  console.log('\n→ Tabelas da Fase 5 presentes:', tables.map((t) => t.table_name).join(', '));

  const cols = (await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name = 'users' AND column_name IN ('whatsapp_contact','latitude','longitude','bi_number','nif_number','kyc_status'))
      OR (table_name = 'products' AND column_name = 'file_url')
      OR (table_name = 'orders' AND column_name IN ('latitude','longitude','platform_commission_kz'))
      OR (table_name = 'wallet_transactions' AND column_name = 'commission_kz')
    ORDER BY table_name, column_name
  `);
  console.log('→ Colunas novas:');
  for (const c of cols) console.log(`   · ${c.table_name}.${c.column_name}`);

  console.log('\n✅ Migração Fase 5 concluída.');
}

main().catch((err) => {
  console.error('❌ Migração falhou:', err);
  process.exit(1);
});
