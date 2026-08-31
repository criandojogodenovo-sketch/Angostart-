#!/usr/bin/env node
/**
 * AngoStart — Migração da FASE 13: prazo de carência de 30 dias para o KYC.
 *
 * O que faz:
 *  1. users.kyc_deadline           — data-limite para enviar o documento
 *                                    (criação + 30 dias; TIMESTAMPTZ).
 *  2. users.kyc_overdue_notified_at — quando o vendedor foi avisado do
 *                                    'overdue' (evita email repetido do cron;
 *                                    o admin pode reenviar o aviso).
 *  3. Backfill: vendedores existentes em 'not_submitted'/'pending' SEM prazo
 *     → kyc_deadline = NOW() + 30 dias (janela nova e completa — modelo
 *     amigável: ninguém é punido por regras que ainda não existiam).
 *  4. Índice parcial para o cron diário (fila de expirados).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS + UPDATEs condicionais).
 *
 * Uso: DATABASE_URL=postgres://… node scripts/migrate-fase13.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida — nunca commitar segredos.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_deadline TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_overdue_notified_at TIMESTAMPTZ`,
  /* Backfill AMIGÁVEL: quem já estava à espera (sem prazo) ganha os 30 dias
     completos a partir de hoje — a Fase 13 não penaliza retroativamente.
     Vendedores verified/rejected não precisam de prazo (verificado sai do
     fluxo; rejected já está bloqueado pela regra da Fase 12). */
  `UPDATE users
      SET kyc_deadline = NOW() + INTERVAL '30 days'
    WHERE role IN ('criador','prestador_domicilio','prestador_remoto')
      AND kyc_status IN ('not_submitted','pending')
      AND kyc_deadline IS NULL`,
  /* Fila do cron diário: encontrar expirados rapidamente */
  `CREATE INDEX IF NOT EXISTS idx_users_kyc_deadline
     ON users (kyc_deadline)
     WHERE kyc_deadline IS NOT NULL
       AND kyc_status IN ('not_submitted','pending')`,
];

(async () => {
  console.log('🚀 Fase 13 — migração prazo de carência KYC…');
  for (const stmt of STATEMENTS) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await sql.query(stmt);
      console.log(`  ✅ ${label}…`);
    } catch (error) {
      console.error(`  ❌ ${label}…`);
      console.error(error.message);
      process.exit(1);
    }
  }

  /* Verificação final */
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('kyc_deadline','kyc_overdue_notified_at')
    ORDER BY column_name`;
  console.log(
    `\n📦 Colunas Fase 13 em users: ${cols.map((c) => c.column_name).join(', ')}`
  );
  const dist = await sql`
    SELECT kyc_status, COUNT(*)::int AS n,
           COUNT(kyc_deadline)::int AS com_prazo
      FROM users
     WHERE role IN ('criador','prestador_domicilio','prestador_remoto')
     GROUP BY kyc_status ORDER BY kyc_status`;
  console.log(
    '👥 Vendedores por estado (estado=n · com_prazo):',
    dist.map((r) => `${r.kyc_status}=${r.n}(${r.com_prazo})`).join(' · ')
  );
  console.log('\n🎉 Migração Fase 13 concluída.');
})().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
