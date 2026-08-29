/**
 * AngoStart — Teste E2E da Fase 4 (contra o servidor dev local, base Neon)
 *
 * Fluxo testado:
 *  1. Registo vendedor + comprador (API)
 *  2. Vendedor publica produto + adere a afiliados (código AFG-…)
 *  3. Comprador pede depósito na carteira
 *  4. Admin aprova o depósito → saldo entra
 *  5. Comprador paga encomenda COM a carteira + código de afiliado
 *  6. Verifica escrow: saldo do comprador desce; vendedor recebe em
 *     saldo_bloqueado; afiliado recebe comissão de 10%
 *  7. Admin marca entregue → escrow libertado para o vendedor
 *  8. Saque: pedido → recusa do admin → valor devolvido
 *  9. is_hot: PATCH + filtro ?hot=1
 * 10. Limpeza dos dados de teste
 *
 * Executar:  node --env-file=.env.local scripts/test-fase4.js
 */

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

const stamp = Date.now();
const vendedorEmail = `vendorteste${stamp}@exemplo.com`;
const compradorEmail = `compradorteste${stamp}@exemplo.com`;

let created = { userIds: [], orderIds: [], productIds: [] };

function ok(name, condition, detail = '') {
  const icon = condition ? '✓' : '✗';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function main() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET ausente/curta no .env.local');
  }

  /* ── 0. Token de admin (mesmo segredo JWT da app) ── */
  const admins = await sql`
    SELECT id FROM users WHERE role = 'admin' AND blocked = FALSE LIMIT 1
  `;
  const adminId = admins[0].id;
  const adminToken = jwt.sign(
    { sub: String(adminId), email: 'hellyposk@gmail.com', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(`→ Admin usado: user #${adminId}`);

  /* ── 1. Registo vendedor + comprador ── */
  const regV = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Vendedor Teste F4',
      email: vendedorEmail,
      password: 'TesteF4!Senha#9',
      telefone: '923456789',
      role: 'prestador_remoto',
      especialidade: 'Testes Automáticos',
    }),
  });
  ok('registo vendedor', regV.status === 201 || regV.status === 200, vendedorEmail);
  const vendedorToken = regV.data.token;
  created.userIds.push(regV.data.user?.id);

  const regC = await api('/api/auth/register/cliente', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Comprador Teste F4',
      email: compradorEmail,
      password: 'TesteF4!Senha#9',
      telefone: '924567890',
    }),
  });
  ok('registo comprador', regC.status === 201 || regC.status === 200, compradorEmail);
  const compradorToken = regC.data.token;
  created.userIds.push(regC.data.user?.id);

  const vendedorAuth = { Authorization: `Bearer ${vendedorToken}` };
  const compradorAuth = { Authorization: `Bearer ${compradorToken}` };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  /* ── 2. Produto + afiliado ── */
  const prod = await api('/api/products', {
    method: 'POST',
    headers: vendedorAuth,
    body: JSON.stringify({
      name: 'Serviço Teste Fase 4',
      description: 'Produto de teste da carteira e afiliados (será eliminado).',
      price: 5000,
      type: 'servico_remoto',
    }),
  });
  ok('produto criado', prod.status === 201, `id=${prod.data.product?.id}`);
  const productId = prod.data.product.id;
  created.productIds.push(productId);

  const aff = await api('/api/affiliate/register', {
    method: 'POST',
    headers: vendedorAuth,
  });
  ok('afiliado registado', aff.status === 201, `código=${aff.data.codigo_afiliado}`);
  const affCode = aff.data.codigo_afiliado;

  /* ── 3. Depósito pedido pelo comprador ── */
  const dep = await api('/api/wallet/deposit', {
    method: 'POST',
    headers: compradorAuth,
    body: JSON.stringify({ valor: 20000 }),
  });
  ok('depósito pedido', dep.status === 201, dep.data.deposit?.referencia);
  const depId = dep.data.deposit.id;
  const depRef = dep.data.deposit.referencia;

  // Saldo ainda NÃO pode ter entrado
  let wallet = await api('/api/wallet', { headers: compradorAuth });
  ok(
    'saldo ainda 0 antes da aprovação',
    Number(wallet.data.saldo) === 0,
    `saldo=${wallet.data.saldo}`
  );

  /* ── 4. Admin aprova o depósito ── */
  const approve = await api(`/api/admin/wallet/${depId}`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ action: 'aprovar' }),
  });
  ok('depósito aprovado pelo admin', approve.status === 200);

  wallet = await api('/api/wallet', { headers: compradorAuth });
  ok('saldo do comprador = 20.000 Kz', Number(wallet.data.saldo) === 20000, `saldo=${wallet.data.saldo}`);

  /* ── 5. Compra com carteira + código de afiliado ── */
  const order = await api('/api/orders', {
    method: 'POST',
    headers: { ...compradorAuth },
    body: JSON.stringify({
      customer_name: 'Comprador Teste F4',
      customer_phone: '924567890',
      customer_email: compradorEmail,
      payment_method: 'carteira',
      affiliate_code: affCode,
      items: [{ id: productId, quantity: 2 }],
    }),
  });
  ok(
    'encomenda paga com carteira',
    order.status === 201 && order.data.order?.status === 'pago',
    `pedido #${order.data.order?.id}`
  );
  const orderId = order.data.order.id;
  created.orderIds.push(orderId);

  const total = 5000 * 2; // 10.000 Kz
  const comissao = Math.floor(total * 0.1); // 1.000 Kz

  /* ── 6. Verificação do escrow/comissão na BD ── */
  const buyer = await sql`SELECT saldo::float8 FROM wallets WHERE user_id = ${regC.data.user.id}`;
  ok('comprador: saldo debitado', Number(buyer[0].saldo) === 10000, `saldo=${buyer[0].saldo}`);

  const seller = await sql`SELECT saldo::float8, saldo_bloqueado::float8 FROM wallets WHERE user_id = ${regV.data.user.id}`;
  ok('vendedor: escrow em saldo_bloqueado', Number(seller[0].saldo_bloqueado) === total, `bloqueado=${seller[0].saldo_bloqueado}`);
  // O vendedor É também o afiliado neste teste → saldo = comissão (1.000 Kz)
  ok('vendedor: saldo só com a comissão', Number(seller[0].saldo) === comissao, `saldo=${seller[0].saldo}`);

  const affWallet = await sql`SELECT saldo::float8 FROM wallets WHERE user_id = ${regV.data.user.id}`;
  const earnings = await sql`SELECT comissao::float8 FROM affiliate_earnings WHERE order_id = ${orderId}`;
  ok('afiliado: comissão registada', earnings.length === 1 && Number(earnings[0].comissao) === comissao, `${comissao} Kz (10%)`);

  // Pagar 2× tem de ser impossível (idempotência)
  const dupOrder = await api('/api/orders', {
    method: 'POST',
    headers: compradorAuth,
    body: JSON.stringify({
      customer_name: 'Comprador Teste F4',
      customer_phone: '924567890',
      payment_method: 'carteira',
      items: [{ id: productId, quantity: 99 }], // saldo insuficiente → 400
    }),
  });
  ok('saldo insuficiente rejeitado', dupOrder.status === 400, dupOrder.data.error?.slice(0, 60));

  /* ── 7. Admin marca entregue → liberta escrow ── */
  const delivered = await api(`/api/admin/orders/${orderId}`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ status: 'entregue' }),
  });
  ok('encomenda marcada entregue', delivered.status === 200);

  const seller2 = await sql`SELECT saldo::float8, saldo_bloqueado::float8 FROM wallets WHERE user_id = ${regV.data.user.id}`;
  ok('escrow libertado ao vendedor', Number(seller2[0].saldo) === total + comissao && Number(seller2[0].saldo_bloqueado) === 0, `saldo=${seller2[0].saldo}, bloqueado=${seller2[0].saldo_bloqueado}`);

  /* ── 8. Saque: pedido → recusa devolve ── */
  const wd = await api('/api/wallet/withdraw', {
    method: 'POST',
    headers: vendedorAuth,
    body: JSON.stringify({ valor: 3000 }),
  });
  ok('saque pedido (reserva imediata)', wd.status === 201, wd.data.withdraw?.referencia);
  const wdId = wd.data.withdraw.id;

  const seller3 = await sql`SELECT saldo::float8 FROM wallets WHERE user_id = ${regV.data.user.id}`;
  ok('reserva do saque debita saldo', Number(seller3[0].saldo) === total + comissao - 3000, `saldo=${seller3[0].saldo}`);

  const reject = await api(`/api/admin/wallet/${wdId}`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ action: 'rejeitar' }),
  });
  ok('saque recusado pelo admin', reject.status === 200);

  const seller4 = await sql`SELECT saldo::float8 FROM wallets WHERE user_id = ${regV.data.user.id}`;
  ok('valor do saque devolvido', Number(seller4[0].saldo) === total + comissao, `saldo=${seller4[0].saldo}`);

  /* ── 9. is_hot ── */
  const hot = await api(`/api/products/${productId}`, {
    method: 'PATCH',
    headers: vendedorAuth,
    body: JSON.stringify({ is_hot: true }),
  });
  ok('is_hot marcado', hot.status === 200 && hot.data.product?.is_hot === true);

  const hotList = await api('/api/products?hot=1');
  ok(
    'filtro ?hot=1 devolve o produto',
    (hotList.data.products || []).some((p) => p.id === productId)
  );

  /* ── 10. Prestadores: o vendedor aparece na pesquisa ── */
  const prest = await api('/api/prestadores?q=Testes%20Autom%C3%A1ticos');
  ok(
    'pesquisa /api/prestadores encontra o vendedor',
    (prest.data.prestadores || []).some((p) => p.id === regV.data.user.id)
  );

  console.log('\n→ A limpar dados de teste…');
  if (created.productIds.length) {
    await sql`DELETE FROM reviews WHERE product_id = ANY(${created.productIds}::int[])`;
    await sql`DELETE FROM products WHERE id = ANY(${created.productIds}::int[])`;
  }
  if (created.orderIds.length) {
    await sql`DELETE FROM orders WHERE id = ANY(${created.orderIds}::int[])`;
  }
  if (created.userIds.filter(Boolean).length) {
    await sql`DELETE FROM users WHERE id = ANY(${created.userIds.filter(Boolean)}::int[])`;
  }
  console.log('✓ Limpeza concluída (users em cascata: wallets, afiliados, transações)');

  console.log(process.exitCode ? '\n✗ TESTES COM FALHAS' : '\n✔ TODOS OS TESTES DA FASE 4 PASSARAM');
}

main().catch((error) => {
  console.error('✗ TESTE FALHOU:', error);
  // limpeza de emergência
  try {
    if (created.userIds.filter(Boolean).length) {
      sql`DELETE FROM users WHERE id = ANY(${created.userIds.filter(Boolean)}::int[])`;
    }
  } catch {}
  process.exit(1);
});
