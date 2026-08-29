/**
 * AngoStart — Migração Fase 6
 *
 * 1. disputes    — disputas cliente vs. vendedor (Fase 6, ponto 7)
 * 2. proposals   — propostas de serviços complexos (Fase 6, ponto 12 — opcional)
 *
 * Executar: node --env-file=.env scripts/migrate-fase6.js
 */

const { neon } = require('@neondatabase/serverless');

function dbUrl() {
  const candidates = [process.env.NEON_DATABASE_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    if (c && c.startsWith('postgres')) return c;
  }
  throw new Error('DATABASE_URL inválida — define NEON_DATABASE_URL no .env');
}

async function main() {
  const sql = neon(dbUrl());
  console.log('━━━ Migração Fase 6 ━━━');

  /* ── 1. Disputas ──
     status: aberta | resolvida_cliente | resolvida_vendedor | cancelada */
  await sql`
    CREATE TABLE IF NOT EXISTS disputes (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),          -- cliente que abre
      seller_id INTEGER REFERENCES users(id),                 -- vendedor alvo (derivado dos items)
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberta',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_by INTEGER REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      resolution TEXT
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
  `;
  console.log('  ✓ tabela disputes');

  /* ── 2. Propostas (serviços complexos — cliente envia, prestador aceita) ──
     status: pendente | aceite | recusada */
  await sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES users(id),
      provider_id INTEGER NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      budget_kz NUMERIC(12,2) NOT NULL CHECK (budget_kz > 0),
      status TEXT NOT NULL DEFAULT 'pendente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_proposals_provider ON proposals(provider_id, status);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_proposals_client ON proposals(client_id, status);
  `;
  console.log('  ✓ tabela proposals');

  console.log('━━━ Migração Fase 6 concluída ━━━');
}

main().catch((error) => {
  console.error('Erro na migração:', error);
  process.exit(1);
});
