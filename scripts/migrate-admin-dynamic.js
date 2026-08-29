/**
 * AngoStart — Migração "administração dinâmica" (convites + códigos diários).
 *
 * ⚠️ SEM SEGREDOS NO FICHEIRO: o email/senha do admin total entram por
 * variáveis de ambiente no momento da execução (nunca no repositório):
 *
 *   env -u DATABASE_URL \
 *     ADMIN_EMAIL='novo.email@exemplo.com' \
 *     ADMIN_PASSWORD='senha-nova-forte' \
 *     node --env-file=.env.local scripts/migrate-admin-dynamic.js
 *
 * O que faz:
 *   1. Cria as tabelas admin_invites, admin_daily_codes, admin_audit.
 *   2. Atualiza o admin total: email → $ADMIN_EMAIL, password_hash →
 *      bcrypt($ADMIN_PASSWORD), 2FA reiniciado (re-inscrição no 1.º login).
 *   3. Remove TODOS os admin_limitado fixos antigos (substituídos por
 *      convites + código diário) e limpa referências/convites/códigos.
 *   4. Regista a migração em admin_audit.
 */
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const newEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const newPassword = process.env.ADMIN_PASSWORD || '';

  if (!EMAIL_RE.test(newEmail)) {
    console.error('✗ Define ADMIN_EMAIL (email válido) na env.');
    process.exit(1);
  }
  if (newPassword.length < 10) {
    console.error('✗ Define ADMIN_PASSWORD (mín. 10 caracteres) na env.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log('→ 1/4 A criar tabelas do sistema dinâmico…');
  await sql`
    CREATE TABLE IF NOT EXISTS admin_invites (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS admin_daily_codes (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      date DATE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (admin_id, date)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      email TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_daily_codes_admin_date
      ON admin_daily_codes (admin_id, date)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_event
      ON admin_audit (event, created_at)
  `;

  console.log('→ 2/4 A limpar admins limitados fixos antigos…');
  // Referências defensivas antes de apagar contas antigas
  await sql`
    UPDATE orders SET validated_by = NULL
    WHERE validated_by IN (SELECT id FROM users WHERE role = 'admin_limitado')
  `;
  await sql`
    UPDATE admin_audit SET user_id = NULL
    WHERE user_id IN (SELECT id FROM users WHERE role = 'admin_limitado')
  `;
  await sql`DELETE FROM admin_daily_codes`;
  await sql`DELETE FROM admin_invites`;
  const removed = await sql`
    DELETE FROM users WHERE role = 'admin_limitado' RETURNING email
  `;
  console.log(`   removidos: ${removed.map((r) => r.email).join(', ') || '(nenhum)'}`);

  console.log('→ 3/4 A atualizar credenciais do admin total…');
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Caso A: já existe conta com o novo email (ex.: antiga conta de cliente)
  // → promove-a a admin total e elimina os outros admins.
  const promoted = await sql`
    UPDATE users
    SET role = 'admin',
        password_hash = ${passwordHash},
        blocked = FALSE,
        two_factor_secret = NULL,
        two_factor_enabled = FALSE
    WHERE email = ${newEmail}
    RETURNING id
  `;
  if (promoted.length > 0) {
    const removedOld = await sql`
      DELETE FROM users
      WHERE role = 'admin' AND email <> ${newEmail}
      RETURNING email
    `;
    console.log(
      `   conta ${newEmail} (id ${promoted[0].id}) promovida a admin total; ` +
        `admins antigos removidos: ${removedOld.map((r) => r.email).join(', ') || '(nenhum)'}`
    );
  } else {
    // Caso B: promove o admin existente e renomeia o email
    const updated = await sql`
      UPDATE users
      SET email = ${newEmail},
          password_hash = ${passwordHash},
          role = 'admin',
          blocked = FALSE,
          two_factor_secret = NULL,
          two_factor_enabled = FALSE
      WHERE role = 'admin'
      RETURNING id
    `;
    if (updated.length === 0) {
      await sql`
        INSERT INTO users (name, email, password_hash, role, username)
        VALUES ('Administrador', ${newEmail}, ${passwordHash}, 'admin', 'admin')
      `;
      console.log('   admin total criado do zero.');
    } else {
      console.log(`   admin total (id ${updated[0].id}) → ${newEmail} + nova senha (2FA reiniciado).`);
    }
  }

  console.log('→ 4/4 A registar auditoria…');
  await sql`
    INSERT INTO admin_audit (email, event, detail)
    VALUES (${newEmail}, 'migration_dynamic_admin',
            'Credenciais do admin total atualizadas; sistema de convites+código diário ativado')
  `;

  // Verificação final (sem revelar segredos)
  const check = await sql`
    SELECT id, email, role, blocked::boolean AS blocked, two_factor_enabled::boolean AS two_fa
    FROM users WHERE role IN ('admin', 'admin_limitado') ORDER BY id
  `;
  console.log('=== ESTADO FINAL ===');
  for (const u of check) console.log(u);
  console.log('✔ Migração concluída.');
}

main().catch((e) => {
  console.error('✗ ERRO:', e.message);
  process.exit(1);
});
