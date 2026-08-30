#!/usr/bin/env node
/**
 * AngoStart — Limpeza de dados de teste (Fase 11, pré-produção).
 *
 * REMOVE (apenas contas de teste conhecidas):
 *  - oficialwehelp@gmail.com (vendedor de teste Fases 9-10 — pedido do CTO)
 *  - cliente1..5@teste.com, cliente_afiliado@teste.com, cliente_neg@teste.com
 *  - vendedor_gate@teste.com, gate.fase10.*@test.ao
 *  - fase11.*@test.ao, k9.probe@test.ao, audit.sec.*@test.ao (resíduos)
 *  - os 21 produtos de teste, encomendas, comissões, carteiras de teste,
 *    lojas, seguidores, notificações, tokens de reset órfãos.
 *
 * MANTÉM: utilizadores reais — admin (hellyposk@gmail.com) e clientes/
 * vendedores reais (ex.: vicentepedro@gmail.com) e todos os seus dados.
 *
 * Segurança: IDs recolhidos da própria BD e validados como inteiros antes
 * de qualquer interpolação; emails por lista fechada + padrões @teste.com
 * e @test.ao (domínios reservados para teste neste projeto).
 *
 * Uso: DATABASE_URL=postgres://… node scripts/cleanup-fase11.js
 */
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const EMAILS = [
  'oficialwehelp@gmail.com',
  'cliente1@teste.com',
  'cliente2@teste.com',
  'cliente3@teste.com',
  'cliente4@teste.com',
  'cliente5@teste.com',
  'cliente_afiliado@teste.com',
  'cliente_neg@teste.com',
  'vendedor_gate@teste.com',
  'k9.probe@test.ao',
];

const PADROES = ['%@test.ao', '%@teste.com']; // gate.fase10.*, fase11.*, audit.sec.*

function intsValidos(ids) {
  return ids.every((n) => Number.isInteger(n) && n > 0);
}

(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
    console.error('❌ DATABASE_URL (Neon) não definida.');
    process.exit(1);
  }

  /* ── 0. Salvaguarda: quem vamos manter (reais) ── */
  const reais = await sql`
    SELECT id, email, role FROM users
    WHERE email NOT LIKE '%@test.ao' AND email NOT LIKE '%@teste.com'
      AND email != ALL(${EMAILS})
    ORDER BY id
  `;
  console.log('👥 Utilizadores REAIS (mantidos):');
  reais.forEach((u) => console.log(`   #${u.id} [${u.role}] ${u.email}`));

  /* ── 1. Recolher contas de teste ── */
  const teste = await sql`
    SELECT id, email FROM users
    WHERE email = ANY(${EMAILS})
       OR email LIKE ${PADROES[0]}
       OR email LIKE ${PADROES[1]}
  `;
  const ids = teste.map((u) => u.id);
  console.log(`\n🧹 A remover ${ids.length} conta(s) de teste…`);
  teste.forEach((u) => console.log(`   #${u.id} ${u.email}`));
  if (ids.length === 0) {
    console.log('Nada a remover.');
    return;
  }
  if (!intsValidos(ids)) throw new Error('Ids inválidos — limpeza abortada.');
  const ph = ids.join(',');

  /* Encomendas cujos ARTIGOS pertencem a contas de teste (comprador
     pode ter sido visitante — customer_email de teste) */
  const ordensPorItens = await sql.query(
    `SELECT id FROM orders
      WHERE user_id IN (${ph})
         OR customer_email = ANY($1::text[])
         OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(items) el
              WHERE (el->>'seller_id') IS NOT NULL
                AND (el->>'seller_id')::int = ANY($2::int[])
            )`,
    [EMAILS, ids]
  );
  const orderIds = [...new Set([...ordensPorItens.map((o) => o.id)])];
  if (orderIds.length && !intsValidos(orderIds)) throw new Error('Order ids inválidos.');
  const oph = orderIds.join(',') || '0';
  console.log(`   (${orderIds.length} encomenda(s) associadas)`);

  /* Produtos de teste */
  const prods = await sql.query(`SELECT id FROM products WHERE user_id IN (${ph})`);
  const prodIds = prods.map((p) => p.id);
  if (!intsValidos(prodIds)) throw new Error('Product ids inválidos.');
  const pph = prodIds.join(',') || '0';

  /* Lojas de teste */
  const lojas = await sql.query(`SELECT id FROM stores WHERE owner_id IN (${ph})`);
  const lojaIds = lojas.map((s) => s.id);
  if (!intsValidos(lojaIds)) throw new Error('Store ids inválidos.');
  const lph = lojaIds.join(',') || '0';

  /* ── 2. Apagar por ordem de dependências ── */
  const passos = [
    ['comentários', `DELETE FROM comments WHERE user_id IN (${ph}) OR (target_type='product' AND target_id IN (${pph})) OR (target_type='store' AND target_id IN (${lph})) OR (target_type='seller' AND target_id IN (${ph}))`],
    ['avaliações', `DELETE FROM reviews WHERE user_id IN (${ph}) OR product_id IN (${pph})`],
    ['comissões de afiliado', `DELETE FROM affiliate_earnings WHERE affiliate_id IN (SELECT id FROM affiliates WHERE user_id IN (${ph})) OR order_id IN (${oph})`],
    ['atividades suspeitas', `DELETE FROM suspicious_activities WHERE user_id IN (${ph})`],
    ['transações de carteira', `DELETE FROM wallet_transactions WHERE user_id IN (${ph}) OR order_id IN (${oph})`],
    ['carteiras', `DELETE FROM wallets WHERE user_id IN (${ph})`],
    ['tokens de reset', `DELETE FROM password_resets WHERE user_id IN (${ph})`],
    ['tokens 2FA/audit admin', `DELETE FROM admin_audit WHERE user_id IN (${ph})`],
    ['notificações', `DELETE FROM notifications WHERE user_id IN (${ph})`],
    ['push subscriptions', `DELETE FROM push_subscriptions WHERE user_id IN (${ph})`],
    ['seguidores de lojas', `DELETE FROM store_followers WHERE user_id IN (${ph}) OR store_id IN (${lph})`],
    ['encomendas', `DELETE FROM orders WHERE id IN (${oph}) OR user_id IN (${ph})`],
    ['lojas', `DELETE FROM stores WHERE id IN (${lph})`],
    ['afiliados', `DELETE FROM affiliates WHERE user_id IN (${ph})`],
    ['pontos de vendedor', `DELETE FROM seller_points WHERE user_id IN (${ph})`],
    ['badges', `DELETE FROM user_badges WHERE user_id IN (${ph})`],
    ['itens de portfólio', `DELETE FROM portfolio_items WHERE user_id IN (${ph})`],
    ['propostas', `DELETE FROM proposals WHERE client_id IN (${ph}) OR provider_id IN (${ph})`],
    ['produtos', `DELETE FROM products WHERE id IN (${pph})`],
    ['utilizadores', `DELETE FROM users WHERE id IN (${ph})`],
  ];

  for (const [nome, query] of passos) {
    try {
      const r = await sql.query(query);
      console.log(`   ✓ ${nome}: ${r.length ?? 0}`);
    } catch (e) {
      console.log(`   ⚠️  ${nome}: ${e.message}`);
    }
  }

  /* ── 3. Tokens de reset expirados globais (higiene, não toca nos válidos) ── */
  const exp = await sql.query(`DELETE FROM password_resets WHERE expires_at < NOW() OR used = TRUE RETURNING id`);
  console.log(`   ✓ tokens de reset expirados/usados (global): ${exp.length}`);

  /* ── 4. Confirmação final ── */
  const fim = await sql.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE email LIKE '%@test.ao' OR email LIKE '%@teste.com' OR email = 'oficialwehelp@gmail.com') AS users_teste,
      (SELECT COUNT(*)::int FROM products) AS produtos,
      (SELECT COUNT(*)::int FROM orders) AS encomendas,
      (SELECT COUNT(*)::int FROM users) AS users
  `);
  const f = fim[0];
  console.log('\n📊 Estado final da BD:');
  console.log(`   utilizadores de teste restantes: ${f.users_teste}`);
  console.log(`   produtos: ${f.produtos} · encomendas: ${f.encomendas} · utilizadores: ${f.users}`);
  if (f.users_teste !== 0) {
    console.error('❌ Ainda há contas de teste — verificação falhou.');
    process.exit(1);
  }
  console.log('✅ Base de dados limpa e pronta para produção.');
})();
