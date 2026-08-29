/**
 * AngoStart — Inspeção do schema (users + tabelas admin dinâmico).
 * Uso: node --env-file=.env.local scripts/inspect-schema.js
 */
const { neon } = require('@neondatabase/serverless');

(async () => {
  const sql = neon(process.env.DATABASE_URL);

  const cols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'admin_invites', 'admin_daily_codes', 'admin_audit')
    ORDER BY table_name, ordinal_position
  `;
  console.log('=== COLUNAS ===');
  for (const c of cols) console.log(`${c.table_name}.${c.column_name} (${c.data_type})`);

  const users = await sql`
    SELECT id, email, role, blocked::boolean AS blocked, two_factor_enabled::boolean AS two_fa
    FROM users WHERE role IN ('admin', 'admin_limitado') ORDER BY id
  `;
  console.log('=== ADMINS ATUAIS ===');
  for (const u of users) console.log(u);

  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM admin_invites) AS invites,
      (SELECT COUNT(*) FROM admin_daily_codes) AS daily_codes,
      (SELECT COUNT(*) FROM admin_audit) AS audit
    WHERE 1=1
  `.catch(() => [{ invites: 'tabela?', daily_codes: 'tabela?', audit: 'tabela?' }]);
  console.log('=== CONTAGENS ===');
  console.log(counts[0]);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
