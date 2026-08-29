/**
 * AngoStart — Migração Fase 7
 *
 * 1. proposals v2    — colunas price_kz / deadline_days / last_offer_by /
 *                      order_id / accepted_at + histórico de contrapropostas
 * 2. push_subscriptions — Web Push (VAPID)
 * 3. badges + user_badges — gamificação de vendedores
 * 4. seller_points   — pontos e nível (bronze→platina)
 * 5. commission_rates / seller_commission_overrides / commission_audit
 *
 * Idempotente — pode correr mais do que uma vez.
 * Executar: node --env-file=.env scripts/migrate-fase7.js
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
  console.log('━━━ Migração Fase 7 ━━━');

  /* ── 1. Propostas v2 (negociação de preço e prazo) ── */
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS price_kz NUMERIC(12,2)`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deadline_days INTEGER`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_offer_by INTEGER REFERENCES users(id)`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS order_id INTEGER`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  // Preenche price_kz das propostas antigas com o budget original
  await sql`UPDATE proposals SET price_kz = budget_kz WHERE price_kz IS NULL`;
  await sql`UPDATE proposals SET last_offer_by = client_id WHERE last_offer_by IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_proposals_provider ON proposals(provider_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_proposals_client ON proposals(client_id, status)`;

  // Histórico de contrapropostas (ambas as partes veem a negociação)
  await sql`
    CREATE TABLE IF NOT EXISTS proposal_counters (
      id SERIAL PRIMARY KEY,
      proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      by_user_id INTEGER NOT NULL REFERENCES users(id),
      price_kz NUMERIC(12,2) NOT NULL CHECK (price_kz > 0),
      deadline_days INTEGER,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_proposal_counters ON proposal_counters(proposal_id, created_at)`;
  console.log('  ✓ proposals v2 + proposal_counters');

  /* ── 2. Push subscriptions (Web Push / VAPID) ── */
  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`;
  console.log('  ✓ push_subscriptions');

  /* ── 3. Gamificação: badges ── */
  await sql`
    CREATE TABLE IF NOT EXISTS badges (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'award',
      criteria TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_badges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, badge_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id)`;

  const BADGES = [
    ['primeira_venda', 'Primeira Venda', 'Concluíste a tua primeira venda na AngoStart.', 'trophy'],
    ['top_vendedor_mes', 'Top Vendedor do Mês', 'Melhor vendedor do mês por receita líquida.', 'crown'],
    ['avaliacao_5', 'Excelência 5 Estrelas', 'Média de avaliações ≥ 4,8 com pelo menos 10 avaliações.', 'star'],
    ['vendas_100', '100 Vendas', 'Alcançaste 100 vendas concluídas.', 'medal'],
    ['resposta_rapida', 'Resposta Rápida', 'Responde às mensagens do chat em menos de 1 hora (média).', 'zap'],
    ['criador_infoprodutos', 'Criador de Infoprodutos', 'Publicou 5 ou mais infoprodutos.', 'book'],
    ['prestador_domicilio', 'Prestador de Confiança', 'Concluiu 20 ou mais serviços ao domicílio.', 'home'],
    ['freelancer_top', 'Freelancer Top', 'Concluiu 10 ou mais projetos remotos.', 'laptop'],
  ];
  for (const [code, name, description, icon] of BADGES) {
    await sql`
      INSERT INTO badges (code, name, description, icon)
      VALUES (${code}, ${name}, ${description}, ${icon})
      ON CONFLICT (code) DO NOTHING
    `;
  }
  console.log('  ✓ badges + user_badges (8 selos)');

  /* ── 4. Pontos de vendedor (cache para níveis) ── */
  await sql`
    CREATE TABLE IF NOT EXISTS seller_points (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      sales_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ seller_points');

  /* ── 5. Comissões flexíveis ── */
  await sql`
    CREATE TABLE IF NOT EXISTS commission_rates (
      id SERIAL PRIMARY KEY,
      scope TEXT NOT NULL UNIQUE,
      percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 50),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS seller_commission_overrides (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 50),
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS commission_audit (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      scope TEXT NOT NULL,
      seller_id INTEGER REFERENCES users(id),
      old_percent NUMERIC(5,2),
      new_percent NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Taxas iniciais (iguais aos defaults do lib/config.ts)
  await sql`
    INSERT INTO commission_rates (scope, percent) VALUES
      ('produto', 5),
      ('servico_domicilio', 10),
      ('freelancer', 6.5)
    ON CONFLICT (scope) DO NOTHING
  `;
  console.log('  ✓ commission_rates + overrides + audit (5/10/6.5%)');

  console.log('━━━ Migração Fase 7 concluída ━━━');
}

main().catch((err) => {
  console.error('Falha na migração:', err);
  process.exit(1);
});
