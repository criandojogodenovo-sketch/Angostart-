/**
 * AngoStart — Limpeza dos dados de teste da FASE 10 (afiliados).
 *
 * Remove: oficialwehelp@gmail.com (vendedor de teste), cliente1..5@teste.com,
 * cliente_afiliado@teste.com, os 5 e-books de teste, as encomendas,
 * comissões, transações de carteira, loja e afiliação associadas.
 *
 * Uso: DATABASE_URL=postgres://... node scripts/cleanup-fase10-test.js
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
  'vendedor_gate@teste.com', // legacy das primeiras execuções
];

const PADRAO_GATE = 'gate.fase10.%.test.ao'; // vendedores gate (únicos por execução)

(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
    console.error('❌ DATABASE_URL não definida.');
    process.exit(1);
  }
  try {
    const placeholders = EMAILS.map((_, i) => `$${i + 1}`).join(',');
    const users = await sql.query(
      `SELECT id FROM users WHERE email IN (${placeholders}) OR email LIKE $${EMAILS.length + 1}`,
      [...EMAILS, PADRAO_GATE]
    );
    const ids = users.map((u) => u.id);
    console.log(`A limpar ${ids.length} utilizadores de teste da Fase 10…`);

    if (ids.length > 0) {
      const ph = ids.join(',');
      await sql.query(
        `DELETE FROM affiliate_earnings WHERE affiliate_id IN (SELECT id FROM affiliates WHERE user_id IN (${ph}))
          OR order_id IN (SELECT id FROM orders WHERE user_id IN (${ph}))`
      );
      await sql.query(`DELETE FROM suspicious_activities WHERE user_id IN (${ph})`);
      await sql.query(
        `DELETE FROM wallet_transactions WHERE user_id IN (${ph})
          OR order_id IN (SELECT id FROM orders WHERE user_id IN (${ph}))`
      );
      await sql.query(`DELETE FROM wallets WHERE user_id IN (${ph})`);
      await sql.query(`DELETE FROM notifications WHERE user_id IN (${ph})`);
      await sql.query(
        `DELETE FROM store_followers WHERE user_id IN (${ph})
          OR store_id IN (SELECT id FROM stores WHERE owner_id IN (${ph}))`
      );
      await sql.query(`DELETE FROM reviews WHERE user_id IN (${ph})`);
      await sql.query(`DELETE FROM stores WHERE owner_id IN (${ph})`);
      await sql.query(`DELETE FROM affiliates WHERE user_id IN (${ph})`);
      await sql.query(`DELETE FROM products WHERE user_id IN (${ph})`);
      await sql.query(`DELETE FROM orders WHERE user_id IN (${ph})`);
      await sql.query(`DELETE FROM users WHERE id IN (${ph})`);
    }

    // Encomendas residuais dos compradores de teste (sem conta associada)
    const extra = await sql.query(
      `DELETE FROM orders WHERE customer_email = ANY($1::text[]) RETURNING id`,
      [EMAILS]
    );
    console.log(`Encomendas residuais removidas: ${extra.length}`);
    console.log('✅ Limpeza da Fase 10 concluída.');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
})();
