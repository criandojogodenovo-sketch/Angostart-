/**
 * AngoStart — Correção de credenciais do admin principal (operação pontual).
 *
 *  1. Lista as contas admin / admin_limitado (sem hashes).
 *  2. Atualiza o password_hash do ADMIN PRINCIPAL (ADMIN_EMAIL, role='admin').
 *  3. Limpa must_change_password de TODOS os utilizadores.
 *  4. Confirma o estado final.
 *
 * 🔒 Segredos fora do repositório — passar por ambiente:
 *    DATABASE_URL=postgres://... ADMIN_EMAIL=hellyposk@gmail.com \
 *    ADMIN_NEW_PASSWORD='<nova senha>' node scripts/admin-credentials-fix.js
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida.');
  process.exit(1);
}
if (!process.env.ADMIN_NEW_PASSWORD || process.env.ADMIN_NEW_PASSWORD.length < 10) {
  console.error('❌ ADMIN_NEW_PASSWORD não definida (mínimo 10 caracteres).');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const ALVO = (process.env.ADMIN_EMAIL || 'hellyposk@gmail.com').toLowerCase();

(async () => {
  /* ── 1. Contas de administração ── */
  const admins = await sql`
    SELECT id, email, role, blocked::boolean AS blocked,
           must_change_password::boolean AS must_change
    FROM users WHERE role IN ('admin', 'admin_limitado') ORDER BY role, id
  `;
  console.log('📋 Contas de administração:');
  for (const a of admins) {
    console.log(
      `   • id=${a.id} ${a.email} (${a.role})${a.blocked ? ' [BLOQUEADA]' : ''} · must_change_password=${a.must_change}`
    );
  }

  /* ── 2. Trocar a senha do admin principal (alvo único) ── */
  const alvo = admins.find(
    (a) => a.role === 'admin' && a.email.toLowerCase() === ALVO
  );
  if (!alvo) {
    console.error(`❌ Admin principal «${ALVO}» (role='admin') não encontrado — nada alterado.`);
    process.exit(1);
  }
  const hash = await bcrypt.hash(process.env.ADMIN_NEW_PASSWORD, 10);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${alvo.id}`;
  console.log(`\n🔑 Senha do admin principal atualizada: id=${alvo.id} ${alvo.email} ✓ (hash não exibido)`);

  /* ── 3. Limpar must_change_password de todos ── */
  const limpos = await sql`
    UPDATE users SET must_change_password = FALSE WHERE must_change_password = TRUE RETURNING id, email
  `;
  console.log(`\n🧹 must_change_password removido de ${limpos.length} utilizador(es).`);

  /* ── 4. Estado final ── */
  const verificacao = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE role = 'admin' AND must_change_password = FALSE) AS admins_ok,
      (SELECT COUNT(*)::int FROM users WHERE must_change_password = TRUE) AS pendentes
  `;
  const v = verificacao[0];
  console.log(`\n✅ Estado final: admins sem flag = ${v.admins_ok} · utilizadores com flag = ${v.pendentes}`);

  /* admins_limitado existentes (para o fluxo do código diário) */
  const limitados = await sql`
    SELECT id, email FROM users WHERE role = 'admin_limitado' AND blocked = FALSE
  `;
  console.log(
    limitados.length === 0
      ? 'ℹ️  Sem admins limitados ativos — o fluxo do código diário está pronto e dormente (gera/envia quando existirem).'
      : `ℹ️  Admins limitados ativos: ${limitados.map((l) => l.email).join(', ')} — código diário via /api/admin/daily-code/generate.`
  );
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
