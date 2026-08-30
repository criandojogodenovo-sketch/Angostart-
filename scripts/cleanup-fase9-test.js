/**
 * AngoStart — Limpeza dos dados de teste da Fase 9.
 * Uso: DATABASE_URL=postgres://... node scripts/cleanup-fase9-test.js
 */
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    // Utilizadores de teste (por prefixo de email)
    const users = await sql`
      SELECT id FROM users WHERE email LIKE 'fase9.%.test.ao' OR email LIKE 'fase9.%@test.ao'`;
    const ids = users.map((u) => u.id);
    console.log(`A limpar ${ids.length} utilizadores de teste…`);

    if (ids.length > 0) {
      const placeholders = ids.join(',');
      // Encomendas de teste explícitas + as associadas aos users de teste
      await sql.query(`DELETE FROM affiliate_earnings WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${placeholders}) OR affiliate_code IN (SELECT codigo_afiliado FROM affiliates WHERE user_id IN (${placeholders})))`);
      await sql.query(`DELETE FROM suspicious_activities WHERE user_id IN (${placeholders})`);
      await sql.query(`DELETE FROM wallet_transactions WHERE user_id IN (${placeholders}) OR order_id IN (SELECT id FROM orders WHERE user_id IN (${placeholders}))`);
      await sql.query(`DELETE FROM wallets WHERE user_id IN (${placeholders})`);
      await sql.query(`DELETE FROM notifications WHERE user_id IN (${placeholders})`);
      await sql.query(`DELETE FROM store_followers WHERE user_id IN (${placeholders}) OR store_id IN (SELECT id FROM stores WHERE owner_id IN (${placeholders}))`);
      await sql.query(`DELETE FROM stores WHERE owner_id IN (${placeholders})`);
      await sql.query(`DELETE FROM affiliates WHERE user_id IN (${placeholders})`);
      await sql.query(`DELETE FROM products WHERE user_id IN (${placeholders})`);
      await sql.query(`DELETE FROM orders WHERE user_id IN (${placeholders}) OR customer_email LIKE 'fase9.%@test.ao'`);
      await sql.query(`DELETE FROM users WHERE id IN (${placeholders})`);
    }

    // Encomendas anónimas de teste (vendas falsas do cenário 4)
    const fakeOrders = await sql`
      DELETE FROM orders WHERE customer_name = 'Cliente Teste' AND customer_phone = '958000000' RETURNING id`;
    console.log(`Encomendas falsas removidas: ${fakeOrders.length}`);

    console.log('✅ Limpeza concluída.');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
})();
