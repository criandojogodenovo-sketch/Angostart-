/**
 * AngoStart — Migração: Fase 21 — IA multi-modelo com visibilidade por perfil.
 *
 * Cria as 3 tabelas novas do roteamento de IA (chat/vision/monitor):
 *
 *   ai_logs           — auditoria de CADA chamada de IA (tarefa, provider,
 *                       modelo, ok, latência, erro). Alimenta a secção
 *                       «IA Interna» do painel admin (chamadas/24h, erros,
 *                       latência média, últimas execuções).
 *
 *   ai_usage_daily    — quotas diárias por utilizador (anti-abuso da API
 *                       gratuita): transcriptions (3/dia), images (10/dia),
 *                       profile_analyses (3/dia).
 *
 *   ai_monitor_alerts — alertas do lote diário de monitorização IA
 *                       (Qwen3.8-Flash): duplicados, ofensivos, spam.
 *                       A IA NUNCA age sozinha — o admin tria (ignorada/
 *                       resolvida) na secção «IA Interna».
 *
 * Idempotente: IF NOT EXISTS — pode correr 2× sem efeito.
 * Uso: node scripts/migrate-fase21.js  (lê DATABASE_URL do .env/local env)
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa)
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

const databaseUrl =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
  console.error(
    '❌ Define DATABASE_URL (postgresql://…) antes de correr esta migração.'
  );
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  console.log('— Fase 21: tabelas da IA multi-modelo —');

  /* 1. Auditoria de chamadas de IA (Fase 21, lib/ai/logs.ts). */
  await sql`
    CREATE TABLE IF NOT EXISTS ai_logs (
      id BIGSERIAL PRIMARY KEY,
      task TEXT NOT NULL CHECK (task IN ('chat', 'vision', 'monitor')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT true,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at
      ON ai_logs (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_logs_task_created
      ON ai_logs (task, created_at DESC)
  `;

  /* 2. Quotas diárias por utilizador (Fase 21, lib/ai/usage.ts). */
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Africa/Luanda')::date,
      transcriptions INTEGER NOT NULL DEFAULT 0,
      images INTEGER NOT NULL DEFAULT 0,
      profile_analyses INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, day)
    )
  `;

  /* 3. Alertas do lote diário de monitorização (Fase 21, lib/ai-monitor.ts). */
  await sql`
    CREATE TABLE IF NOT EXISTS ai_monitor_alerts (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('duplicado', 'ofensivo', 'spam')),
      severity TEXT NOT NULL DEFAULT 'media'
        CHECK (severity IN ('alta', 'media', 'baixa')),
      entity_type TEXT NOT NULL
        CHECK (entity_type IN ('produto', 'comentario', 'mensagem')),
      entity_id INTEGER NOT NULL,
      related_entity_id INTEGER,
      excerpt TEXT,
      reason TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'aberta'
        CHECK (status IN ('aberta', 'ignorada', 'resolvida')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_monitor_alerts_status
      ON ai_monitor_alerts (status, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_monitor_alerts_entity
      ON ai_monitor_alerts (entity_type, entity_id)
  `;

  /* Confirmação */
  const tables = (await sql`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('ai_logs', 'ai_usage_daily', 'ai_monitor_alerts')
     ORDER BY table_name
  `) ;
  console.log(
    '✅ Tabelas presentes:',
    tables.map((t) => t.table_name).join(', ')
  );
}

main()
  .then(() => {
    console.log('✅ Migração Fase 21 concluída.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Falha na migração:', error.message || error);
    process.exit(1);
  });
