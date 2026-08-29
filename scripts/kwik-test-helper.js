/**
 * AngoStart — Auxiliar do teste E2E KWiK (cria/limpa dados de teste).
 * Uso: node scripts/kwik-test-helper.js <create-product|cleanup|check-orders> [productId]
 */
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const [command, productId] = process.argv.slice(2);

async function main() {
  if (command === 'create-product') {
    const r = await sql`
      INSERT INTO products (name, description, price_kz, type)
      VALUES ('Produto Teste KWiK', 'produto temporário de teste', 1000, 'produto_fisico')
      RETURNING id
    `;
    console.log(r[0].id);
    return;
  }

  if (command === 'cleanup') {
    await sql`DELETE FROM orders WHERE customer_name LIKE 'Teste%'`;
    if (productId) {
      await sql`DELETE FROM products WHERE id = ${Number(productId)}`;
    }
    console.log('✓ dados de teste eliminados');
    return;
  }

  if (command === 'check-orders') {
    const rows = await sql`
      SELECT id, customer_name, customer_phone, status, payment_method,
             (payment_proof IS NOT NULL) AS tem_comprovativo,
             payment_proof_name, admin_note, validated_at
      FROM orders WHERE customer_name LIKE 'Teste%' ORDER BY id
    `;
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.error('Comando desconhecido:', command);
  process.exit(1);
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
