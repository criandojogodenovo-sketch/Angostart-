/**
 * AngoStart — Migração Fase 4
 * (Favicon já é ficheiro; aqui ficam as mudanças de base de dados)
 *
 * 1. products.is_hot (boolean) — badge "Em alta 🔥"
 * 2. wallets            — carteira por utilizador (saldo + saldo_bloqueado/escrow)
 * 3. wallet_transactions — diário de movimentações (depósito, saque, pagamento,
 *                          recebimento, comissão, liberação, reembolso)
 * 4. affiliates         — códigos de afiliado + percentual de comissão
 * 5. affiliate_earnings — comissões ganhas por venda paga
 * 6. orders.affiliate_code — código de afiliado aplicado no checkout
 * 7. DELETE FROM products — catálogo REAL (remove produtos de exemplo)
 *
 * Executar:  node --env-file=.env.local scripts/migrate-fase4.js
 */

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  console.log('→ A ligar ao Neon…');

  /* 1. Hot badge em products */
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_hot BOOLEAN NOT NULL DEFAULT FALSE`;
  console.log('✓ products: is_hot BOOLEAN DEFAULT FALSE');

  /* 2. Carteiras (1:1 com users) */
  await sql`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      saldo NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
      saldo_bloqueado NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo_bloqueado >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log('✓ wallets criada (saldo + saldo_bloqueado)');

  /* 3. Diário de transações da carteira */
  await sql`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN
        ('deposito','saque','pagamento','recebimento','comissao','liberacao','reembolso')),
      valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN
        ('pendente','concluido','rejeitado','bloqueado')),
      referencia VARCHAR(60),
      order_id INTEGER,
      descricao TEXT,
      processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Idempotência de movimentações por encomenda (creditar 2× é impossível)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_order_tipo_user_uniq
    ON wallet_transactions (order_id, tipo, user_id)
    WHERE order_id IS NOT NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_transactions (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS wallet_tx_pendentes_idx ON wallet_transactions (status, created_at DESC)`;
  console.log('✓ wallet_transactions criada (+ índices e idempotência por order)');

  /* 4. Afiliados */
  await sql`
    CREATE TABLE IF NOT EXISTS affiliates (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      codigo_afiliado VARCHAR(20) NOT NULL UNIQUE,
      comissao_percentual NUMERIC(5,2) NOT NULL DEFAULT 10.00
        CHECK (comissao_percentual >= 0 AND comissao_percentual <= 50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  /* 5. Comissões ganhas (1 por afiliado/encomenda) */
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_earnings (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL,
      comissao NUMERIC(14,2) NOT NULL CHECK (comissao > 0),
      percentual NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      status VARCHAR(20) NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','cancelado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (affiliate_id, order_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS affiliate_earnings_affiliate_idx ON affiliate_earnings (affiliate_id, created_at DESC)`;
  console.log('✓ affiliates + affiliate_earnings criadas');

  /* 6. Código de afiliado no checkout */
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_code TEXT`;
  console.log('✓ orders: affiliate_code TEXT');

  /* 7. Carteiras para utilizadores já existentes (lazy-create também existe) */
  const seeded = await sql`
    INSERT INTO wallets (user_id)
    SELECT id FROM users
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  `;
  console.log(`✓ wallets garantidas (+${seeded.length} novas)`);

  /* 8. Catálogo REAL — remove os produtos de exemplo (Fase 4) */
  const antes = await sql`SELECT count(*)::int AS n FROM products`;
  await sql`DELETE FROM products`;
  console.log(`✓ products limpo (${antes[0]?.n ?? 0} registos de exemplo removidos)`);

  const estado = await sql`
    SELECT
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM wallets) AS wallets,
      (SELECT count(*)::int FROM affiliates) AS affiliates,
      (SELECT count(*)::int FROM wallet_transactions) AS wallet_transactions
  `;
  console.log(`✓ estado final: ${JSON.stringify(estado[0])}`);
  console.log('MIGRAÇÃO FASE 4 CONCLUÍDA ✔');
}

main().catch((error) => {
  console.error('✗ MIGRAÇÃO FALHOU:', error);
  process.exit(1);
});
