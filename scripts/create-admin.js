/**
 * AngoStart — Cria/promove um utilizador para admin ou admin_limitado.
 *
 * Uso:
 *   env -u DATABASE_URL node --env-file=.env.local scripts/create-admin.js \
 *     <email> <password> [admin|admin_limitado] [Nome]
 *
 * - Se o email já existe → promove a conta (e atualiza a palavra-passe).
 * - Se não existe → cria a conta nova com o role indicado.
 * - O 2FA é ativado depois, no painel (tab "Segurança 2FA" → QR code).
 */

const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

async function main() {
  const [email, password, roleArg, nameArg] = process.argv.slice(2);
  const role = roleArg === 'admin_limitado' ? 'admin_limitado' : 'admin';

  if (!email || !password) {
    console.error('Uso: node scripts/create-admin.js <email> <password> [admin|admin_limitado] [Nome]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('✗ A palavra-passe deve ter pelo menos 8 caracteres.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const name = nameArg || email.split('@')[0];
  const passwordHash = await bcrypt.hash(password, 10);
  const emailNorm = String(email).trim().toLowerCase();

  const existing = await sql`SELECT id FROM users WHERE email = ${emailNorm} LIMIT 1`;

  if (existing.length > 0) {
    await sql`
      UPDATE users
      SET role = ${role}, password_hash = ${passwordHash}, blocked = FALSE
      WHERE email = ${emailNorm}
    `;
    console.log(`✓ Conta existente promovida: ${emailNorm} → ${role}`);
  } else {
    const username = emailNorm.split('@')[0].replace(/[^a-z0-9]+/g, '.').slice(0, 24) || 'admin';
    await sql`
      INSERT INTO users (name, email, password_hash, role, username)
      VALUES (${name}, ${emailNorm}, ${passwordHash}, ${role}, ${username})
    `;
    console.log(`✓ Novo ${role} criado: ${emailNorm}`);
  }

  console.log('Próximos passos:');
  console.log(`  1. Abre /admin (URL direto) e entra com ${emailNorm}`);
  console.log('  2. No painel, tab "Segurança 2FA" → gera o QR e lê na app autenticadora');
  console.log('  3. Sai e volta a entrar com o código TOTP de 6 dígitos');
}

main().catch((error) => {
  console.error('✗ FALHOU:', error.message);
  process.exit(1);
});
