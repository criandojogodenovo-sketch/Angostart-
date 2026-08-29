/** Verifica auditoria registada e limpeza dos dados de teste. */
const { neon } = require('@neondatabase/serverless');

(async () => {
  const sql = neon(process.env.DATABASE_URL);

  const audit = await sql`
    SELECT event, COUNT(*)::int AS n
    FROM admin_audit GROUP BY event ORDER BY event
  `;
  console.log('=== ADMIN_AUDIT (eventos) ===');
  for (const a of audit) console.log(`${a.event}: ${a.n}`);

  const leftovers = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE email = 'teste@exemplo.com') AS test_user,
      (SELECT COUNT(*)::int FROM admin_invites WHERE email = 'teste@exemplo.com') AS test_invite,
      (SELECT COUNT(*)::int FROM admin_daily_codes) AS daily_codes,
      (SELECT COUNT(*)::int FROM users WHERE role = 'admin_limitado') AS limited_admins,
      (SELECT COUNT(*)::int FROM users WHERE role = 'admin') AS total_admins
  `;
  console.log('=== RESÍDUOS DE TESTE (deve ser tudo 0, exceto total_admins=1) ===');
  console.log(leftovers[0]);

  const admins = await sql`
    SELECT id, email, role FROM users WHERE role IN ('admin','admin_limitado')
  `;
  console.log('=== ADMINS FINAIS ===');
  for (const a of admins) console.log(a);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
