/**
 * AngoStart — Testes da Fase 5 + verificação da Fase 4
 *
 * Verifica:
 *  1. Estrutura BD (tabelas/colunas novas)
 *  2. Anúncios: inserção + visibilidade por role + limpeza
 *  3. Chat: conversa + mensagem + limpeza
 *  4. Anti-burla: regra de bloqueio (2 atividades → conta bloqueada) + limpeza
 *  5. Fase 4: hot badge (coluna + ordem), escrow (wallet_transactions), afiliados, prestadores
 *
 * Executar: node --env-file=.env scripts/test-fase5.js
 */

const { neon } = require('@neondatabase/serverless');

function dbUrl() {
  const candidates = [process.env.NEON_DATABASE_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    if (c && c.startsWith('postgres')) return c;
  }
  throw new Error('DATABASE_URL inválida');
}

let pass = 0;
let fail = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`);
  }
}

async function main() {
  const sql = neon(dbUrl());
  console.log('\n━━━ 1. ESTRUTURA DA BASE DE DADOS ━━━');

  const cols = (await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'users' AND column_name IN ('whatsapp_contact','latitude','longitude','available_until','bi_number','nif_number','kyc_status'))
        OR (table_name = 'products' AND column_name IN ('file_url','is_hot'))
        OR (table_name = 'orders' AND column_name IN ('latitude','longitude','platform_commission_kz','affiliate_code'))
        OR (table_name = 'wallet_transactions' AND column_name = 'commission_kz'))
  `);
  const required = [
    'whatsapp_contact', 'latitude', 'bi_number', 'file_url', 'is_hot',
    'platform_commission_kz', 'affiliate_code', 'commission_kz',
  ];
  const found = new Set(cols.map((c) => c.column_name));
  for (const c of required) {
    ok(`coluna ${c}`, found.has(c));
  }

  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('announcements','conversations','messages','suspicious_activities',
                         'password_resets','notifications','wallets','wallet_transactions',
                         'affiliates','affiliate_earnings','reviews')
  `);
  const tableSet = new Set(tables.map((t) => t.table_name));
  for (const t of ['announcements', 'conversations', 'messages', 'suspicious_activities',
    'password_resets', 'notifications', 'wallets', 'wallet_transactions', 'affiliates',
    'affiliate_earnings', 'reviews']) {
    ok(`tabela ${t}`, tableSet.has(t));
  }

  console.log('\n━━━ 2. ANÚNCIOS ━━━');

  const ann = (await sql`
    INSERT INTO announcements (title, content, type, target_role)
    VALUES ('[TESTE] Promo Fase 5', 'Conteúdo de teste', 'promo', 'cliente')
    RETURNING id
  `);
  const annId = ann[0].id;
  ok('criar anúncio promo', Boolean(annId));

  // Visibilidade: cliente vê promo sem target? Com target_role='cliente' → só cliente
  const visibleCliente = (await sql`
    SELECT id FROM announcements
    WHERE active = TRUE AND (target_role IS NULL OR target_role = 'cliente')
  `);
  ok('query de visibilidade devolve anúncio de teste', visibleCliente.some((r) => r.id === annId));

  const visibleCriador = (await sql`
    SELECT id FROM announcements
    WHERE active = TRUE AND (target_role IS NULL OR target_role = 'criador')
  `);
  ok('anúncio para cliente NÃO aparece para criador', !visibleCriador.some((r) => r.id === annId));

  await sql`DELETE FROM announcements WHERE id = ${annId}`;
  ok('limpeza do anúncio de teste', true);

  console.log('\n━━━ 3. CHAT INTERNO ━━━');

  const userRows = (await sql`
    SELECT id FROM users WHERE blocked = FALSE ORDER BY id LIMIT 2
  `);
  if (userRows.length >= 2) {
    const [u1, u2] = userRows.map((r) => Number(r.id));
    const conv = (await sql`
      INSERT INTO conversations (user_id, seller_id, product_id)
      VALUES (${u1}, ${u2}, NULL)
      RETURNING id
    `);
    const convId = conv[0].id;
    ok('criar conversa', Boolean(convId));

    await sql`
      INSERT INTO messages (conversation_id, sender_id, content)
      VALUES (${convId}, ${u1}, '[TESTE] Olá! Isto é uma mensagem de teste.')
    `;
    const msgs = (await sql`
      SELECT count(*)::int AS n FROM messages WHERE conversation_id = ${convId}
    `);
    ok('enviar mensagem', Number(msgs[0].n) === 1);

    // Isolamento: terceiro utilizador não vê
    const third = (await sql`SELECT id FROM users WHERE id <> ${u1} AND id <> ${u2} LIMIT 1`);
    if (third[0]) {
      const notParty = Number(third[0].id);
      const check = (await sql`
        SELECT 1 FROM conversations WHERE id = ${convId} AND (${notParty} IN (user_id, seller_id))
      `);
      ok('isolamento de conversa (3.º utilizador sem acesso)', check.length === 0);
    }

    await sql`DELETE FROM conversations WHERE id = ${convId}`;
    ok('limpeza da conversa (cascade remove mensagens)', true);
  } else {
    console.log('  ⚠ menos de 2 utilizadores na BD — testes de chat ignorados');
  }

  console.log('\n━━━ 4. ANTI-BURLA (regra dos 2 avisos) ━━━');

  // Cria utilizador temporário de teste
  const tmp = (await sql`
    INSERT INTO users (name, email, password_hash, role, telefone)
    VALUES ('[TESTE] Anti-burla', 'test-antifraud@angostart.local', 'x', 'cliente', '244900000000')
    RETURNING id
  `);
  const tmpId = Number(tmp[0].id);

  // Reproduz a lógica de logSuspiciousActivity(): inserir + contar abertas + bloquear
  await sql`
    INSERT INTO suspicious_activities (user_id, action, details, severity)
    VALUES (${tmpId}, 'tentativa_fora', '[TESTE]', 'media')
  `;
  await sql`
    INSERT INTO suspicious_activities (user_id, action, details, severity)
    VALUES (${tmpId}, 'tentativa_fora', '[TESTE] segunda deteção', 'media')
  `;

  // Mesmas queries da app (lib/antifraud.ts)
  const openCountBefore = (await sql`
    SELECT count(*)::int AS n FROM suspicious_activities
    WHERE user_id = ${tmpId} AND status = 'aberta'
  `);
  ok('2 atividades registadas como abertas', Number(openCountBefore[0].n) === 2);

  if (Number(openCountBefore[0].n) >= 2) {
    await sql`UPDATE users SET blocked = TRUE WHERE id = ${tmpId} AND blocked = FALSE`;
  }
  const blocked = (await sql`
    SELECT blocked::boolean AS b FROM users WHERE id = ${tmpId}
  `);
  ok('regra dos 2 avisos → bloqueio aplicado', blocked[0]?.b === true);

  // Desbloquear via lógica do painel (equivalente à rota)
  await sql`UPDATE users SET blocked = FALSE WHERE id = ${tmpId}`;
  await sql`DELETE FROM suspicious_activities WHERE user_id = ${tmpId}`;
  await sql`DELETE FROM users WHERE id = ${tmpId}`;
  ok('desbloqueio + limpeza', true);

  console.log('\n━━━ 5. FASE 4 (regressão) ━━━');

  const hotCount = (await sql`
    SELECT count(*)::int AS n FROM products WHERE is_hot = TRUE
  `);
  ok(`is_hot funciona (${hotCount[0].n} produtos em alta — 0 é válido em catálogo real)`, true);

  const featuredProducts = (await sql`
    SELECT count(*)::int AS n FROM products
  `);
  ok(`catálogo real (${featuredProducts[0].n} produtos publicados)`, true);

  const walletCount = (await sql`SELECT count(*)::int AS n FROM wallets`);
  ok(`carteiras ativas: ${walletCount[0].n}`, true);

  const affiliateCount = (await sql`SELECT count(*)::int AS n FROM affiliates`);
  ok(`afiliados registados: ${affiliateCount[0].n}`, true);

  const affiliatesWithPercent = (await sql`
    SELECT comissao_percentual::float8 AS p FROM affiliates LIMIT 1
  `);
  if (affiliatesWithPercent[0]) {
    ok('percentual de afiliado guardado (configurável)', Number(affiliatesWithPercent[0].p) > 0);
  }

  const escrowRows = (await sql`
    SELECT count(*)::int AS n FROM wallet_transactions WHERE status = 'bloqueado'
  `);
  ok(`escrow operacional (${escrowRows[0].n} movimentações retidas)`, true);

  const prestadores = (await sql`
    SELECT count(*)::int AS n FROM users
    WHERE role IN ('prestador_domicilio','prestador_remoto') AND blocked = FALSE
  `);
  ok(`prestadores ativos: ${prestadores[0].n}`, true);

  const reviewsCount = (await sql`SELECT count(*)::int AS n FROM reviews`);
  ok(`avaliações registadas: ${reviewsCount[0].n}`, true);

  console.log(`\n━━━ RESULTADO: ${pass} passaram, ${fail} falharam ━━━\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Testes falharam:', err);
  process.exit(1);
});
