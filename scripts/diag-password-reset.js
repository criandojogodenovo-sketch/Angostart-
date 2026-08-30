/**
 * AngoStart — Diagnóstico do bug "link de recuperação inválido na 1ª tentativa".
 * READ-ONLY: não altera dados. Segredos apenas via env (DATABASE_URL).
 *
 * Investiga:
 *  1. Schema real de password_resets (tipos, defaults, triggers)
 *  2. Últimas linhas — created_at vs expires_at (intervalo real), used flag
 *  3. Utilizadores com múltiplos pedidos (padrão "2º link funciona")
 */
const { neon } = require('@neondatabase/serverless');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL no ambiente.');
    process.exit(1);
  }
  const db = neon(url);

  console.log('=== 1. Schema de password_resets ===');
  const cols = await db`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'password_resets'
    ORDER BY ordinal_position
  `;
  console.table(cols);

  const triggers = await db`
    SELECT trigger_name, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'password_resets'
  `;
  console.log('Triggers:', triggers.length ? triggers : 'nenhum');

  console.log('\n=== 2. Últimas 12 linhas (hash mascarado) ===');
  const rows = await db`
    SELECT r.id,
           left(r.token_hash, 10) || '…' AS token_hash_prefix,
           length(r.token_hash) AS hash_len,
           r.used,
           r.created_at,
           r.expires_at,
           r.expires_at - r.created_at AS validity,
           (r.expires_at AT TIME ZONE 'UTC') > (now() AT TIME ZONE 'UTC') AS still_valid_now
    FROM password_resets r
    ORDER BY r.created_at DESC
    LIMIT 12
  `;
  console.table(rows);

  console.log('\n=== 3. Tipos de dados de created_at / expires_at ===');
  const tz = await db`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'password_resets' AND column_name IN ('created_at','expires_at')
  `;
  console.table(tz);
  const nowCheck = await db`SELECT now() AS db_now, current_setting('TimeZone') AS tz`;
  console.log('DB now / timezone:', nowCheck[0]);

  console.log('\n=== 4. Utilizadores com >1 pedido de reset (padrão do bug) ===');
  const multi = await db`
    SELECT u.email, count(*) AS pedidos,
           count(*) FILTER (WHERE r.used) AS usados,
           min(r.created_at) AS primeiro, max(r.created_at) AS ultimo
    FROM password_resets r JOIN users u ON u.id = r.user_id
    GROUP BY u.email HAVING count(*) > 1
    ORDER BY ultimo DESC LIMIT 10
  `;
  console.table(multi);

  console.log('\n=== 5. Linhas usadas vs nunca usadas ===');
  const stats = await db`
    SELECT used, count(*) AS total,
           min(expires_at - created_at) AS menor_validade,
           max(expires_at - created_at) AS maior_validade
    FROM password_resets GROUP BY used
  `;
  console.table(stats);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
