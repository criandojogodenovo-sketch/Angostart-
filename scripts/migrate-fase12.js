#!/usr/bin/env node
/**
 * AngoStart — Migração da FASE 12: KYC flexível orientado a fotos.
 *
 * O que faz:
 *  1. users.kyc_document_url        — URL do documento (Blob privado, rota
 *                                     autorizada /api/kyc/document/...).
 *  2. users.kyc_document_type       — 'bi' | 'passaporte' | 'cartao_eleitor'.
 *  3. users.kyc_rejection_reason    — motivo da rejeição (mostrado + email).
 *  4. users.kyc_submitted_at        — última submissão do documento.
 *  5. users.kyc_reviewed_at/by      — auditoria da decisão do admin.
 *  6. Backfill: kyc_document_url ← bi_document_url (fotos da Fase 9);
 *     vendedores sem documento e sem BI → kyc_status = 'not_submitted';
 *     vendedores com BI/documento e estado 'none'/'not_submitted' → 'pending'.
 *  7. Índice parcial por kyc_status para a fila do admin.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS + UPDATEs condicionais).
 *
 * Uso: DATABASE_URL=postgres://… node scripts/migrate-fase12.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida — nunca commitar segredos.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_url TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_type TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reviewed_by INTEGER`,
  /* Tipo de documento validado por CHECK (idempotente via condicional IF NOT EXISTS) */
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_kyc_document_type_check') THEN
       ALTER TABLE users ADD CONSTRAINT users_kyc_document_type_check
         CHECK (kyc_document_type IS NULL OR kyc_document_type IN ('bi','passaporte','cartao_eleitor'));
     END IF;
   END $$`,
  /* Backfill: fotos de BI da Fase 9 passam a ser o documento KYC canónico */
  `UPDATE users SET kyc_document_url = bi_document_url,
                    kyc_document_type = 'bi'
     WHERE kyc_document_url IS NULL AND bi_document_url IS NOT NULL`,
  /* Vendedores com documento/BI submetido e estado velho → 'pending' (em análise) */
  `UPDATE users SET kyc_status = 'pending',
                    kyc_submitted_at = COALESCE(kyc_submitted_at, NOW())
     WHERE role IN ('criador','prestador_domicilio','prestador_remoto')
       AND kyc_status IN ('none','not_submitted')
       AND (kyc_document_url IS NOT NULL OR bi_number IS NOT NULL)
       AND is_verified_bi = FALSE`,
  /* Vendedores sem documento e sem BI (nunca submeteram) → 'not_submitted' */
  `UPDATE users SET kyc_status = 'not_submitted'
     WHERE role IN ('criador','prestador_domicilio','prestador_remoto')
       AND kyc_status IN ('none','pending')
       AND kyc_document_url IS NULL
       AND bi_number IS NULL
       AND is_verified_bi = FALSE`,
  /* Fila do admin: filtrar por estado é frequente */
  `CREATE INDEX IF NOT EXISTS idx_users_kyc_status
     ON users (kyc_status)
     WHERE role IN ('criador','prestador_domicilio','prestador_remoto')`,
];

(async () => {
  console.log('🚀 Fase 12 — migração KYC flexível…');
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
    WHERE table_name = 'users' AND column_name LIKE 'kyc%'
    ORDER BY column_name`;
  console.log(
    `\n📦 Colunas KYC em users: ${cols.map((c) => c.column_name).join(', ')}`
  );
  const estados = await sql`
    SELECT kyc_status, COUNT(*)::int AS n FROM users GROUP BY kyc_status ORDER BY kyc_status`;
  console.log(
    '👥 Distribuição kyc_status:',
    estados.map((r) => `${r.kyc_status}=${r.n}`).join(' · ')
  );
  console.log('\n🎉 Migração Fase 12 concluída.');
})().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
