/**
 * AngoStart — Migração: Fase 17 (termos de serviço obrigatórios).
 *
 * 1. users.aceitou_termos — BOOLEAN NOT NULL DEFAULT FALSE
 *    - Utilizadores JÁ existentes ficam com TRUE (grandfathered: não podem
 *      re-aceitar retroativamente e não podem ser bloqueados do login).
 *    - Novos registos só entram com aceitarTermos=true na API (Fase 17).
 *
 * Idempotente: IF NOT EXISTS — pode correr 2× sem efeito.
 * Uso: node scripts/migrate-fase17.js  (lê DATABASE_URL/NEON_DATABASE_URL do .env)
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa)
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
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
  console.log('— Fase 17: users.aceitou_termos —');

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aceitou_termos BOOLEAN NOT NULL DEFAULT FALSE
  `;
  console.log('  ✓ coluna aceitou_termos garantida (IF NOT EXISTS)');

  /* Grandfathering: quem já tem conta não deve ser bloqueado por uma
     regra introduzida depois do seu registo. Corre sempre (idempotente):
     só atinge quem ainda está a FALSE e já existia antes desta Fase 17
     (o registo da Fase 17 já insere TRUE directamente). */
  const backfilled = await sql`
    UPDATE users
    SET aceitou_termos = TRUE
    WHERE aceitou_termos = FALSE
    RETURNING id
  `;
  console.log(`  ✓ grandfathering: ${backfilled.length} utilizador(es) existente(s) marcado(s) TRUE`);

  const check = await sql`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'aceitou_termos'
  `;
  if (check.length === 0) {
    throw new Error('Coluna aceitou_termos não encontrada após ALTER — verificar permissões.');
  }
  console.log('  ✓ verificação final:', JSON.stringify(check[0]));
  console.log('✅ Migração Fase 17 concluída.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Migração falhou:', error.message);
    process.exit(1);
  });
