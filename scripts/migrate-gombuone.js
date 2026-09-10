#!/usr/bin/env node
/**
 * GOMBUONE (evolução da AngoStart) — Migração do MOTOR DE CAMPANHAS.
 *
 * Cria 3 tabelas novas, sem tocar em nenhuma tabela existente:
 *
 *   campaigns         — estratégia/iniciativa de uma empresa (dono = vendedor).
 *   opportunities     — oferta/benefício/ação concreta dentro de uma campanha
 *                       (desconto, brinde, missão…), com missão verificável.
 *   redemption_codes  — código seguro e imprevisível emitido ao consumidor
 *                       (GMB-XXXXXX), com atribuição de distribuição
 *                       (afiliado + canal) e validação atômica na loja.
 *
 * Reutiliza a arquitetura existente:
 *  - dono → users (mesmo modelo de products.user_id / stores.owner_id)
 *  - atribuição → affiliates (AFG-XXXXXX, sub_id por canal — Fase 10)
 *  - identidade anónima do consumidor → cookie httpOnly (nunca IP)
 *
 * Idempotente: IF NOT EXISTS — pode correr 2× sem efeito.
 * Nenhuma migration destrutiva; nenhum dado existente é alterado.
 *
 * Uso: DATABASE_URL=postgres://… node scripts/migrate-gombuone.js
 * ⚠️ Nunca commitar a connection string — passa-a inline no terminal.
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa) — igual a migrate-fase21.js
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      const key = m ? m[1] : null;
      if (key && !process.env[key]) {
        process.env[key] = m[2].replace(/^["']|["']$/g, '');
      }
    });
} catch {
  /* .env opcional */
}

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
  console.error('❌ Define DATABASE_URL (postgresql://…) antes de correr esta migração.');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  console.log('🚀 GOMBUONE — migração do motor de campanhas e oportunidades…');

  /* 1. Campanhas: estratégia de uma empresa/vendedor. */
  await sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id BIGSERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'rascunho'
        CHECK (status IN ('rascunho', 'ativa', 'pausada', 'terminada')),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner
      ON campaigns (owner_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaigns_status_created
      ON campaigns (status, created_at DESC)
  `;

  /* 2. Oportunidades: oferta/benefício/ação dentro de uma campanha.
        A MISSÃO é um campo da oportunidade (ação verificável) — mantida
        deliberadamente simples, integrada à arquitetura existente. */
  await sql`
    CREATE TABLE IF NOT EXISTS opportunities (
      id BIGSERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL DEFAULT 'oferta'
        CHECK (kind IN ('oferta', 'desconto', 'missao', 'brinde', 'evento')),
      discount_percent INTEGER CHECK (discount_percent IS NULL OR discount_percent BETWEEN 1 AND 100),
      mission_text TEXT,
      total_codes INTEGER NOT NULL DEFAULT -1,
      max_claims_per_consumer INTEGER NOT NULL DEFAULT 1,
      code_ttl_hours INTEGER NOT NULL DEFAULT 72,
      status TEXT NOT NULL DEFAULT 'ativa'
        CHECK (status IN ('ativa', 'pausada', 'esgotada', 'terminada')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_opportunities_campaign
      ON opportunities (campaign_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_opportunities_status
      ON opportunities (status, created_at DESC)
  `;

  /* 3. Códigos de redemption: emitidos ao consumidor (identidade anónima
        por cookie httpOnly — NUNCA IP), com atribuição de distribuição
        (afiliado que partilhou + canal) e validação atômica pelo dono. */
  await sql`
    CREATE TABLE IF NOT EXISTS redemption_codes (
      id BIGSERIAL PRIMARY KEY,
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      anon_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ref_affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE SET NULL,
      sub_id TEXT,
      status TEXT NOT NULL DEFAULT 'emitido'
        CHECK (status IN ('emitido', 'utilizado', 'expirado', 'invalidado')),
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_redemption_opportunity
      ON redemption_codes (opportunity_id, claimed_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_redemption_code
      ON redemption_codes (code)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_redemption_affiliate
      ON redemption_codes (ref_affiliate_id)
      WHERE ref_affiliate_id IS NOT NULL
  `;
  /* Idempotência do claim: um consumidor anónimo só tem UM código ativo
     por oportunidade (re-claim devolve o mesmo código). */
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_redemption_active_per_anon
      ON redemption_codes (opportunity_id, anon_id)
      WHERE status = 'emitido'
  `;

  /* Verificação final */
  const cols = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_name IN ('campaigns', 'opportunities', 'redemption_codes')
     ORDER BY table_name, ordinal_position`;
  const grouped = {};
  for (const c of cols) {
    grouped[c.table_name] = (grouped[c.table_name] || []).concat(c.column_name);
  }
  console.log('\n📦 Tabelas GOMBUONE criadas/verificadas:');
  for (const [table, list] of Object.entries(grouped)) {
    console.log(`  ${table} (${list.length} colunas): ${list.join(', ')}`);
  }
  console.log('\n🎉 Migração GOMBUONE concluída. Nenhuma tabela existente foi alterada.');
}

main().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
