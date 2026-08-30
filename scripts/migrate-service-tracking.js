/**
 * AngoStart — Migração: serviços ao domicílio em tempo real.
 *
 * 1. users.is_available          — prestador ligado/desligado (checkout bloqueia se offline)
 * 2. orders.delivery_address     — morada de entrega (encomendas físicas/domicílio)
 * 3. orders.service_completed*   — confirmação de conclusão pelo cliente (liberta escrow)
 * 4. orders.service_started_at   — prestador clicou "Iniciar deslocação"
 * 5. orders.prestador_lat/lng*   — rastreamento GPS do prestador (atualização a cada 5 s)
 * 6. orders.tracking_active      — rastreamento ligado (para ao confirmar)
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS — pode correr 2× sem efeito.
 * Uso: DATABASE_URL=... node scripts/migrate-service-tracking.js
 */
const { neon } = require('@neondatabase/serverless');

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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_completed BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_completed_at TIMESTAMPTZ`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_started_at TIMESTAMPTZ`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS prestador_lat DOUBLE PRECISION`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS prestador_lng DOUBLE PRECISION`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS prestador_loc_updated_at TIMESTAMPTZ`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_active BOOLEAN NOT NULL DEFAULT FALSE`,
  // Índices de consulta frequente (tracking a cada 5 s + listagens do prestador)
  `CREATE INDEX IF NOT EXISTS idx_orders_tracking_active ON orders(tracking_active) WHERE tracking_active = TRUE`,
  `CREATE INDEX IF NOT EXISTS idx_users_is_available ON users(is_available) WHERE is_available = TRUE`,
];

(async () => {
  for (const stmt of STATEMENTS) {
    const label = stmt.slice(0, 72).replace(/\s+/g, ' ');
    await sql.query(stmt);
    console.log(`✓ ${label}…`);
  }

  // Verificação final — colunas que a app vai usar
  const check = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name IN ('delivery_address','service_completed','service_started_at','prestador_lat','prestador_lng','prestador_loc_updated_at','tracking_active')
    ORDER BY column_name
  `;
  const userCheck = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_available'
  `;

  const orderCols = check.map((r) => r.column_name);
  const hasUserCol = userCheck.length === 1;

  console.log('\n── Verificação final ──');
  console.log(`users.is_available: ${hasUserCol ? '✓' : '✗ FALTA'}`);
  console.log(
    `orders (7 novas colunas): ${orderCols.length === 7 ? '✓ todas presentes' : `✗ só ${orderCols.length}/7 → ${orderCols.join(', ')}`}`
  );

  if (!hasUserCol || orderCols.length !== 7) {
    process.exit(1);
  }
  console.log('\n🎉 Migração concluída com sucesso.');
})().catch((err) => {
  console.error('❌ Migração falhou:', err.message);
  process.exit(1);
});
