/**
 * AngoStart — Testes E2E da Fase 9 (executar com o servidor de produção a correr)
 *
 * Uso:
 *   DATABASE_URL=postgres://... JWT_SECRET=... BASE_URL=http://localhost:3000 node scripts/test-fase9.js
 *
 * Cenários (do prompt da Fase 9):
 *  1. Registo de vendedor sem BI → 400
 *  2. Registo de vendedor com idade < 15 → 400
 *  3. Senha fraca → bloqueada (cliente e vendedor)
 *  4. Afiliado vendedor (7+ vendas) pode ativar
 *  5. Afiliado cliente (2+ compras) pode ativar
 *  6. Afiliado sem requisitos → bloqueado com mensagem clara
 *  7. Link de afiliado → compra paga → comissão creditada (+ autoindicação bloqueada)
 *  8. Loja criada automaticamente + API de lojas funciona
 *  9. Verificação de BI no admin (aprovar → publica · pendente → bloqueado)
 */
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET;
const sql = neon(process.env.DATABASE_URL);

let passed = 0;
let failed = 0;
const created = { users: [], orders: [], products: [], stores: [] };

function ok(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, json };
}

const strongPassword = 'Ango@Test#2026';
const suffix = Date.now().toString(36).slice(-5);

(async () => {
  console.log('🧪 Fase 9 — testes E2E\n');

  /* ── Admin token (para KYC + validação de comprovativos) ── */
  const adminRows = await sql`
    SELECT id, email, role FROM users WHERE role = 'admin' LIMIT 1`;
  const admin = adminRows[0];
  const adminToken = jwt.sign(
    { sub: String(admin.id), email: admin.email, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(`👤 Admin de teste: ${admin.email}`);

  /* ── 1. Vendedor sem BI → 400 ── */
  console.log('\n1️⃣ Registo de vendedor SEM BI');
  let r = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: {
      name: `Fase9 SemBI ${suffix}`,
      email: `fase9.nobi.${suffix}@test.ao`,
      password: strongPassword,
      telefone: '958111111',
      role: 'criador',
      bio: 'Teste automático da fase 9 da AngoStart.',
      birth_date: '1995-05-10',
    },
  });
  ok('sem BI devolve 400', r.status === 400, `→ ${r.status} ${JSON.stringify(r.json)}`);

  /* ── 2. Vendedor com idade < 15 → 400 ── */
  console.log('\n2️⃣ Registo com idade < 15');
  r = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: {
      name: `Fase9 Menor ${suffix}`,
      email: `fase9.menor.${suffix}@test.ao`,
      password: strongPassword,
      telefone: '958111112',
      role: 'criador',
      bio: 'Teste automático da fase 9 da AngoStart.',
      bi_number: '004587896LA038',
      birth_date: '2015-01-01',
    },
  });
  ok(
    'idade < 15 devolve 400 com mensagem correta',
    r.status === 400 && /idade mínima/i.test(r.json?.error ?? ''),
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );

  /* ── 3. Senhas fracas → bloqueadas ── */
  console.log('\n3️⃣ Senha fraca bloqueada');
  for (const [label, senha] of [
    ['curta', 'Ab1!'],
    ['sem maiúscula', 'angotest123!'],
    ['sem número', 'AngoTeste!'],
    ['sem símbolo', 'AngoTeste123'],
    ['comum', 'Password1!'],
  ]) {
    r = await api('/api/auth/register/cliente', {
      method: 'POST',
      body: {
        name: `Fase9 Fraca ${suffix}`,
        email: `fase9.fraca.${suffix}@test.ao`,
        password: senha,
        telefone: '958111113',
      },
    });
    ok(`senha ${label} → 400`, r.status === 400, `→ ${r.status}`);
  }

  /* ── Registos válidos (cliente + vendedor) ── */
  console.log('\n📦 Registos válidos (base para os cenários seguintes)');
  r = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: {
      name: `Fase9 Vendedor ${suffix}`,
      email: `fase9.vendedor.${suffix}@test.ao`,
      password: strongPassword,
      telefone: '958222111',
      role: 'criador',
      bio: 'Vendedor de teste da fase 9 com bio suficientemente longa.',
      bi_number: '004587896LA038',
      birth_date: '1995-05-10',
    },
  });
  ok('registo de vendedor válido → 201', r.status === 201, `→ ${r.status} ${JSON.stringify(r.json)}`);
  const seller = { ...(r.json?.user ?? {}), token: r.json?.token };

  r = await api('/api/auth/register/cliente', {
    method: 'POST',
    body: {
      name: `Fase9 Cliente ${suffix}`,
      email: `fase9.cliente.${suffix}@test.ao`,
      password: strongPassword,
      telefone: '958333111',
    },
  });
  ok('registo de cliente válido → 201', r.status === 201, `→ ${r.status}`);
  const client = { ...(r.json?.user ?? {}), token: r.json?.token };

  created.users.push(seller.id, client.id);

  /* ── 8. Loja criada automaticamente ── */
  console.log('\n8️⃣ Loja automática');
  r = await api('/api/stores?minha=1', { token: seller.token });
  const store = r.json?.store;
  ok('vendedor tem loja automática', r.status === 200 && Boolean(store?.slug), `→ ${r.status} ${JSON.stringify(r.json)}`);
  ok(
    'loja tem nome do proprietário e slug',
    Boolean(store?.name) && /^[a-z0-9-]+$/.test(store?.slug ?? ''),
    `→ ${JSON.stringify(store)}`
  );
  created.stores.push(store?.id);

  /* ── 9a. Publicar com BI pendente → 403 KYC_PENDING ── */
  console.log('\n9️⃣ Verificação de BI (publicação bloqueada antes da aprovação)');
  r = await api('/api/products', {
    method: 'POST',
    token: seller.token,
    body: {
      name: 'Produto Teste Fase 9',
      description: 'Descrição de teste suficientemente longa para passar a validação.',
      price: 1000,
      type: 'produto_fisico',
    },
  });
  ok(
    'publicar com BI pendente → 403 KYC_PENDING',
    r.status === 403 && r.json?.code === 'KYC_PENDING',
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );

  /* ── 9b. Admin aprova BI → publica ── */
  r = await api('/api/admin/kyc', {
    method: 'POST',
    token: adminToken,
    body: { user_id: seller.id, action: 'aprovar' },
  });
  ok('admin aprova BI → ok', r.status === 200 && r.json?.is_verified_bi === true, `→ ${r.status} ${JSON.stringify(r.json)}`);

  r = await api('/api/products', {
    method: 'POST',
    token: seller.token,
    body: {
      name: 'Produto Teste Fase 9',
      description: 'Descrição de teste suficientemente longa para passar a validação.',
      price: 1000,
      type: 'produto_fisico',
    },
  });
  ok('após aprovação, publicar → 201', r.status === 201, `→ ${r.status} ${JSON.stringify(r.json)}`);
  if (r.json?.product?.id) created.products.push(r.json.product.id);

  /* ── 6. Afiliado sem requisitos → 403 ── */
  console.log('\n6️⃣ Afiliado sem requisitos');
  r = await api('/api/affiliate/register', { method: 'POST', token: client.token });
  ok(
    'cliente sem compras → 403 com mensagem clara',
    r.status === 403 && /necessitas de/i.test(r.json?.error ?? ''),
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );
  r = await api('/api/affiliate/register', { method: 'POST', token: seller.token });
  ok(
    'vendedor sem vendas → 403 com mensagem clara',
    r.status === 403 && /necessitas de/i.test(r.json?.error ?? ''),
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );

  /* ── 4. Vendedor com 7 vendas → pode ativar ── */
  console.log('\n4️⃣ Afiliado vendedor (7+ vendas)');
  for (let i = 0; i < 7; i += 1) {
    const inserted = await sql`
      INSERT INTO orders (customer_name, customer_phone, items, total_kz, status, delivery_type, user_id)
      VALUES ('Cliente Teste', '958000000', ${JSON.stringify([{ id: 1, name: 'x', quantity: 1, price_kz: 500, seller_id: seller.id }])}::jsonb, 500, 'pago', 'entrega', NULL)
      RETURNING id`;
    created.orders.push(inserted[0].id);
  }
  r = await api('/api/affiliate/register', { method: 'POST', token: seller.token });
  ok(
    'vendedor com 7 vendas → afiliado criado',
    r.status === 201 && /^AFG-/.test(r.json?.codigo_afiliado ?? ''),
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );
  const sellerAffiliateCode = r.json?.codigo_afiliado;

  /* ── 5. Cliente com 2 compras → pode ativar ── */
  console.log('\n5️⃣ Afiliado cliente (2+ compras)');
  for (let i = 0; i < 2; i += 1) {
    const inserted = await sql`
      INSERT INTO orders (customer_name, customer_phone, items, total_kz, status, delivery_type, user_id)
      VALUES ('Cliente Teste', '958000000', ${JSON.stringify([{ id: 1, name: 'x', quantity: 1, price_kz: 2000 }])}::jsonb, 2000, 'pago', 'entrega', ${client.id})
      RETURNING id`;
    created.orders.push(inserted[0].id);
  }
  r = await api('/api/affiliate/register', { method: 'POST', token: client.token });
  ok(
    'cliente com 2 compras → afiliado criado',
    r.status === 201 && /^AFG-/.test(r.json?.codigo_afiliado ?? ''),
    `→ ${r.status} ${JSON.stringify(r.json)}`
  );
  const clientAffiliateCode = r.json?.codigo_afiliado;

  /* ── 7. Compra paga via link do afiliado → comissão ── */
  console.log('\n7️⃣ Comissão de afiliado + anti-fraude');
  // 7a. Compra LEGÍTIMA: cliente (afiliado código próprio NÃO usado) compra
  // com o código do vendedor → admin valida → comissão creditada.
  const orderRows = await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, affiliate_code, ip_address)
    VALUES ('Fase9 Comprador', '958444111', 'fase9.comprador@test.ao', ${JSON.stringify([{ id: created.products[0] ?? 1, name: 'Produto Teste Fase 9', quantity: 1, price_kz: 10000, seller_id: seller.id }])}::jsonb, 10000, 'pendente', 'entrega', NULL, ${sellerAffiliateCode}, '10.9.9.9')
    RETURNING id`;
  const legitOrderId = orderRows[0].id;
  created.orders.push(legitOrderId);

  r = await api(`/api/admin/orders/${legitOrderId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'pago' },
  });
  ok('admin valida pagamento da encomenda de teste', r.status === 200, `→ ${r.status} ${JSON.stringify(r.json)}`);

  const earnings = await sql`
    SELECT comissao::float8 AS comissao, percentual::float8 AS percentual, product_id
    FROM affiliate_earnings WHERE order_id = ${legitOrderId} LIMIT 1`;
  ok(
    'comissão creditada (10% de 10.000 = 1.000 Kz)',
    earnings.length === 1 && Number(earnings[0].comissao) === 1000 && Number(earnings[0].percentual) === 10,
    `→ ${JSON.stringify(earnings)}`
  );
  ok(
    'produto_id registado no ganho (encomenda de 1 item)',
    earnings.length === 1 && earnings[0].product_id !== null,
    `→ product_id = ${earnings[0]?.product_id}`
  );

  const walletTx = await sql`
    SELECT valor::float8 AS valor FROM wallet_transactions
    WHERE order_id = ${legitOrderId} AND tipo = 'comissao' LIMIT 1`;
  ok(
    'comissão cai na carteira do afiliado (saldo disponível)',
    walletTx.length === 1 && Number(walletTx[0].valor) === 1000,
    `→ ${JSON.stringify(walletTx)}`
  );

  // 7b. AUTOINDICAÇÃO: cliente compra com o PRÓPRIO código → bloqueada.
  const selfRows = await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, affiliate_code, ip_address)
    VALUES ('Fase9 Auto', '958444112', 'fase9.auto@test.ao', ${JSON.stringify([{ id: created.products[0] ?? 1, name: 'x', quantity: 1, price_kz: 5000, seller_id: seller.id }])}::jsonb, 5000, 'pendente', 'entrega', ${client.id}, ${clientAffiliateCode}, '10.9.9.9')
    RETURNING id`;
  const selfOrderId = selfRows[0].id;
  created.orders.push(selfOrderId);

  r = await api(`/api/admin/orders/${selfOrderId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'pago' },
  });

  const selfEarnings = await sql`
    SELECT id FROM affiliate_earnings WHERE order_id = ${selfOrderId} LIMIT 1`;
  const suspicious = await sql`
    SELECT id FROM suspicious_activities
    WHERE user_id = ${client.id} AND action = 'fraude_afiliado' LIMIT 1`;
  ok('autoindicação → comissão NÃO creditada', selfEarnings.length === 0, `→ ${JSON.stringify(selfEarnings)}`);
  ok('autoindicação → atividade suspeita registada + admin notificado', suspicious.length === 1, `→ ${JSON.stringify(suspicious)}`);

  /* ── RESUMO ── */
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Resultado: ${passed} passaram · ${failed} falharam`);
  console.log(`🧹 Dados de teste criados: ${created.users.length} utilizadores, ${created.orders.length} encomendas, ${created.products.length} produtos`);
  console.log(`   Limpeza: node scripts/cleanup-fase9-test.js`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('❌ ERRO FATAL:', e);
  process.exit(1);
});
