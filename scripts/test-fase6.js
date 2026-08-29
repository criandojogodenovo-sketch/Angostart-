/**
 * AngoStart — Testes da Fase 6
 *
 * Cobre:
 *  1. Source checks (sem WhatsApp em perfis públicos, PWA, mobile nav, sandbox MoMenu)
 *  2. Portfolio API: mini-loja (stats, reviews, rating estimado, SEM whatsapp/telefone)
 *  3. Anti-auto-avaliação (dono → 403)
 *  4. KYC: publicar sem BI → 403 KYC_REQUIRED; com BI → 201
 *  5. Disputas: fluxo completo (abrir, duplicado 409, alheia 403, resolver a favor do
 *     cliente com clawback+reembolso, resolver a favor do vendedor com libertação)
 *  6. Propostas: criar, listar, aceitar
 *  7. Config/MoMenu: flags públicas; sem chave → 503
 *  8. PWA: /manifest.webmanifest e /sw.js servidos
 *
 * Executar: node --env-file=.env scripts/test-fase6.js
 * (servidor de produção em TEST_BASE_URL, por omissão http://localhost:3456)
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3456';
const SUFFIX = Date.now();

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

function dbUrl() {
  const candidates = [process.env.NEON_DATABASE_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    if (c && c.startsWith('postgres')) return c;
  }
  throw new Error('DATABASE_URL inválida');
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* não-JSON */
  }
  return { status: res.status, text, json };
}

async function registerAndLogin(email, name, endpoint) {
  const body = { name, email, password: `Teste${SUFFIX}!`, telefone: '+244900000000' };
  if (endpoint === 'vendedor') {
    body.role = 'criador';
    body.bio = 'Vendedor de teste E2E da AngoStart.';
  }
  await api('POST', `/api/auth/register/${endpoint}`, { body });
  const login = await api('POST', '/api/auth/login', {
    body: { email, password: `Teste${SUFFIX}!` },
  });
  if (!login.json?.token) {
    throw new Error(`Login falhou para ${email}: ${login.status} ${login.text.slice(0, 200)}`);
  }
  return { token: login.json.token, user: login.json.user };
}

function checkSources() {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

  const portfolioPage = read('app', 'portfolio', '[username]', 'page.tsx');
  const prestadoresPage = read('app', 'prestadores', 'page.tsx');
  const productPage = read('app', 'produtos', '[id]', 'page.tsx');
  const layout = read('app', 'layout.tsx');
  const momenuLib = read('lib', 'momenu.ts');
  const productsApi = read('app', 'api', 'products', 'route.ts');

  ok('Portfólio público sem CTA WhatsApp', !/wa\.me/.test(portfolioPage));
  ok('Prestadores sem CTA WhatsApp', !/wa\.me/.test(prestadoresPage));
  ok('Página de produto sem CTA WhatsApp do vendedor', !/wa\.me/.test(productPage));
  ok('Layout inclui BottomNav (mobile)', /BottomNav/.test(layout));
  ok('Layout inclui ServiceWorkerRegister (PWA)', /ServiceWorkerRegister/.test(layout));
  ok('manifest.ts existe', fs.existsSync(path.join(__dirname, '..', 'src', 'app', 'manifest.ts')));
  ok('public/sw.js existe', fs.existsSync(path.join(__dirname, '..', 'public', 'sw.js')));
  ok('Ícones PWA 192/512 existem', fs.existsSync(path.join(__dirname, '..', 'public', 'icons', 'icon-192.png')) && fs.existsSync(path.join(__dirname, '..', 'public', 'icons', 'icon-512.png')));
  ok('MoMenu: sandbox implementado', /MOMENU_SANDBOX/.test(momenuLib) && /momenuEnabled/.test(momenuLib));
  ok('Catálogo público sem file_url', !/p\.file_url/.test(productsApi.split('meu=1')[1] ?? productsApi));
}

async function main() {
  console.log('━━━ Fase 6 — testes E2E ━━━\n');
  checkSources();

  const sql = neon(dbUrl());

  /* ── Utilizadores ── */
  const sellerEmail = `f6-seller-${SUFFIX}@e2e.angostart`;
  const buyerEmail = `f6-buyer-${SUFFIX}@e2e.angostart`;
  const strangerEmail = `f6-stranger-${SUFFIX}@e2e.angostart`;

  const seller = await registerAndLogin(sellerEmail, 'Vendedor Fase6', 'vendedor');
  const buyer = await registerAndLogin(buyerEmail, 'Comprador Fase6', 'cliente');
  const stranger = await registerAndLogin(strangerEmail, 'Estranho Fase6', 'cliente');
  ok('3 utilizadores de teste criados', true);

  // username único para o portfólio
  const username = `f6seller${SUFFIX}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  await sql`UPDATE users SET username = ${username} WHERE email = ${sellerEmail}`;

  /* ── Fixtures: produtos ── */
  const infoProd = (await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock, file_url)
    VALUES ('E2E F6 Ebook', 'Infoproduto de teste', 1000, 'infoproduto', 'graduation-cap', 'from-emerald-400 to-emerald-600', '', ${seller.user.id}, FALSE, 4.5, -1, 'https://fakestore.blob.vercel-storage.com/x.pdf')
    RETURNING id
  `)[0];
  const serviceProd = (await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock)
    VALUES ('E2E F6 Serviço', 'Serviço remoto de teste', 5000, 'servico_remoto', 'globe', 'from-sky-400 to-sky-600', '', ${seller.user.id}, FALSE, 4.5, -1)
    RETURNING id
  `)[0];
  const productId = Number(infoProd.id);
  const serviceId = Number(serviceProd.id);

  /* ── Encomendas pagas (comprador) ── */
  const order1 = (await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, payment_method)
    VALUES ('Comprador Fase6', '+244900000000', ${buyerEmail},
            ${JSON.stringify([{ id: productId, name: 'E2E F6 Ebook', price_kz: 1000, quantity: 1, seller_id: seller.user.id }])}::jsonb,
            1000, 'pago', 'retirada', ${buyer.user.id}, 'kwik')
    RETURNING id
  `)[0];
  const order2 = (await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, payment_method)
    VALUES ('Comprador Fase6', '+244900000000', ${buyerEmail},
            ${JSON.stringify([{ id: productId, name: 'E2E F6 Ebook', price_kz: 1000, quantity: 1, seller_id: seller.user.id }])}::jsonb,
            1000, 'pago', 'retirada', ${buyer.user.id}, 'kwik')
    RETURNING id
  `)[0];
  const order1Id = Number(order1.id);
  const order2Id = Number(order2.id);

  /* ── Escrow fixture: vendedor com valor bloqueado das duas encomendas ── */
  await sql`
    INSERT INTO wallets (user_id, saldo, saldo_bloqueado) VALUES (${seller.user.id}, 0, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
  await sql`
    INSERT INTO wallets (user_id, saldo, saldo_bloqueado) VALUES (${buyer.user.id}, 0, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
  for (const oid of [order1Id, order2Id]) {
    await sql`
      INSERT INTO wallet_transactions (user_id, tipo, valor, status, order_id, descricao)
      VALUES (${seller.user.id}, 'recebimento', 900, 'bloqueado', ${oid}, 'Venda confirmada (fixture)')
    `;
  }
  await sql`UPDATE wallets SET saldo_bloqueado = 1800 WHERE user_id = ${seller.user.id}`;

  try {
    /* ── 1. Portfolio API (mini-loja) ── */
    console.log('\n━━━ Portfolio — Mini-Loja (ponto 1 + 2) ━━━');
    const port = await api('GET', `/api/portfolio/${username}`);
    ok('Portfólio carrega', port.status === 200, `status=${port.status}`);
    ok('SEM whatsapp/telefone no payload', port.json?.seller && !('whatsapp' in port.json.seller) && !('telefone' in port.json.seller));
    ok('Stats presentes (produtos, clientes)', typeof port.json?.seller?.total_produtos === 'number' && typeof port.json?.seller?.total_clientes === 'number');
    ok('Rating estimado para novo vendedor', port.json?.seller?.total_avaliacoes === 0 && typeof port.json?.seller?.rating_estimado === 'number');
    ok('Lista de avaliações presente', Array.isArray(port.json?.reviews));

    /* ── 2. Anti-auto-avaliação (ponto 6) ── */
    console.log('\n━━━ Avaliações — anti-auto-avaliação (ponto 6) ━━━');
    // O vendedor "compra" o próprio produto (fixture) para passar o gate de compra e testar o bloqueio
    const selfOrder = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, payment_method)
      VALUES ('Vendedor Fase6', '+244900000000', ${sellerEmail},
              ${JSON.stringify([{ id: productId, name: 'E2E F6 Ebook', price_kz: 1000, quantity: 1 }])}::jsonb,
              1000, 'pago', 'retirada', ${seller.user.id}, 'kwik')
      RETURNING id
    `)[0];
    await sql`UPDATE orders SET items = items || '{"x":1}'::jsonb WHERE id = ${Number(selfOrder.id)}`; // no-op, mantém tipo
    const selfReview = await api('POST', '/api/reviews', {
      token: seller.token,
      body: { product_id: productId, rating: 5, comment: 'Auto-avaliação deve ser bloqueada' },
    });
    ok('Dono NÃO avalia o próprio produto (403)', selfReview.status === 403, `status=${selfReview.status} body=${selfReview.text.slice(0, 80)}`);
    await sql`DELETE FROM orders WHERE id = ${Number(selfOrder.id)}`;

    /* ── 3. KYC: BI obrigatório para publicar (ponto 12) ── */
    console.log('\n━━━ KYC — BI obrigatório (ponto 12) ━━━');
    await sql`UPDATE users SET bi_number = NULL WHERE email = ${sellerEmail}`;
    const noKyc = await api('POST', '/api/products', {
      token: seller.token,
      body: { name: 'Sem KYC', description: 'Deve falhar sem BI', price: 2000, type: 'infoproduto' },
    });
    ok('Publicar sem BI → 403 KYC_REQUIRED', noKyc.status === 403 && noKyc.json?.code === 'KYC_REQUIRED', `status=${noKyc.status}`);
    await sql`UPDATE users SET bi_number = '004587896LA038' WHERE email = ${sellerEmail}`;
    const withKyc = await api('POST', '/api/products', {
      token: seller.token,
      body: { name: 'Com KYC', description: 'Deve passar com BI confirmado', price: 2000, type: 'infoproduto' },
    });
    ok('Publicar com BI → 201', withKyc.status === 201, `status=${withKyc.status}`);

    /* ── 4. Disputas (ponto 7) ── */
    console.log('\n━━━ Disputas (ponto 7) ━━━');
    const adminRow = (await sql`
      SELECT id FROM users WHERE role = 'admin' AND blocked = FALSE ORDER BY id LIMIT 1
    `)[0];
    const adminToken = jwt.sign(
      { sub: String(adminRow.id), email: 'admin@test.local', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const shortReason = await api('POST', '/api/disputes', {
      token: buyer.token,
      body: { order_id: order1Id, reason: 'curto' },
    });
    ok('Motivo curto → 400', shortReason.status === 400);

    const foreign = await api('POST', '/api/disputes', {
      token: stranger.token,
      body: { order_id: order1Id, reason: 'Tentativa de disputar encomenda alheia à margem' },
    });
    ok('Disputa de encomenda alheia → 403', foreign.status === 403, `status=${foreign.status}`);

    const opened = await api('POST', '/api/disputes', {
      token: buyer.token,
      body: { order_id: order1Id, reason: 'O produto chegou diferente do anunciado, quero reembolso.' },
    });
    ok('Cliente abre disputa → 201', opened.status === 201, `status=${opened.status} ${opened.text.slice(0, 80)}`);

    const dup = await api('POST', '/api/disputes', {
      token: buyer.token,
      body: { order_id: order1Id, reason: 'Segunda disputa para a mesma encomenda deve falhar.' },
    });
    ok('Disputa duplicada → 409', dup.status === 409, `status=${dup.status}`);

    const adminList = await api('GET', '/api/admin/disputes', { token: adminToken });
    ok('Admin lista disputas', adminList.status === 200 && adminList.json?.disputes?.some((d) => d.order_id === order1Id));

    const anonResolve = await api('PATCH', `/api/admin/disputes/${opened.json.dispute.id}`, {
      body: { favor: 'cliente' },
    });
    ok('Sem sessão admin → resolver falha (401)', anonResolve.status === 401 || anonResolve.status === 403);

    // Saldo antes
    const before = (await sql`SELECT saldo::float8 AS s, saldo_bloqueado::float8 AS b FROM wallets WHERE user_id = ${buyer.user.id}`)[0];

    const resolvedClient = await api('PATCH', `/api/admin/disputes/${opened.json.dispute.id}`, {
      token: adminToken,
      body: { favor: 'cliente', note: 'Razão procedente — reembolso integral.' },
    });
    ok('Resolve a favor do cliente → ok', resolvedClient.status === 200 && resolvedClient.json?.ok, `status=${resolvedClient.status}`);

    const after = (await sql`SELECT saldo::float8 AS s, saldo_bloqueado::float8 AS b FROM wallets WHERE user_id = ${buyer.user.id}`)[0];
    const sellerAfter = (await sql`SELECT saldo::float8 AS s, saldo_bloqueado::float8 AS b FROM wallets WHERE user_id = ${seller.user.id}`)[0];
    ok(`Cliente recebe reembolso (+1000 Kz)`, Math.round(after.s - (before?.s ?? 0)) === 1000, `saldo ${before?.s}→${after.s}`);
    ok('Escrow do vendedor reduzido (−900 Kz)', Math.round(sellerAfter.b) === 900, `bloqueado=${sellerAfter.b}`);
    const reembolsoTx = (await sql`
      SELECT 1 FROM wallet_transactions WHERE order_id = ${order1Id} AND tipo = 'reembolso' AND user_id = ${buyer.user.id} LIMIT 1
    `);
    ok('Movimentação reembolso registada', reembolsoTx.length === 1);

    // Segunda disputa → a favor do vendedor (libertação do escrow)
    const opened2 = await api('POST', '/api/disputes', {
      token: buyer.token,
      body: { order_id: order2Id, reason: 'Teste de resolução a favor do vendedor com libertação.' },
    });
    const sellerBeforeS = (await sql`SELECT saldo::float8 AS s FROM wallets WHERE user_id = ${seller.user.id}`)[0];
    const resolvedSeller = await api('PATCH', `/api/admin/disputes/${opened2.json.dispute.id}`, {
      token: adminToken,
      body: { favor: 'vendedor', note: 'Vendedor cumpriu — libertar escrow.' },
    });
    const sellerAfterS = (await sql`SELECT saldo::float8 AS s, saldo_bloqueado::float8 AS b FROM wallets WHERE user_id = ${seller.user.id}`)[0];
    ok('Resolve a favor do vendedor → ok', resolvedSeller.status === 200 && resolvedSeller.json?.ok, `status=${resolvedSeller.status}`);
    ok('Escrow libertado ao vendedor (+900 Kz no saldo)', Math.round(sellerAfterS.s - (sellerBeforeS?.s ?? 0)) === 900 && Math.round(sellerAfterS.b) === 0, `saldo=${sellerAfterS.s} bloqueado=${sellerAfterS.b}`);

    const myDisputes = await api('GET', '/api/disputes', { token: buyer.token });
    ok('Cliente vê as suas disputas (2)', myDisputes.json?.disputes?.length === 2, `n=${myDisputes.json?.disputes?.length}`);

    /* ── 5. Propostas (ponto 12) ── */
    console.log('\n━━━ Propostas (ponto 12) ━━━');
    const prop = await api('POST', '/api/proposals', {
      token: buyer.token,
      body: { service_id: serviceId, description: 'Preciso de uma versão personalizada do serviço com entregas semanais.', budget_kz: 8000 },
    });
    ok('Cliente envia proposta → 201', prop.status === 201, `status=${prop.status} ${prop.text.slice(0, 80)}`);
    const propId = prop.json?.proposal?.id;
    const providerList = await api('GET', '/api/proposals', { token: seller.token });
    ok('Prestador vê a proposta recebida', providerList.json?.proposals?.some((p) => p.id === propId && p.is_mine === false));
    const accept = await api('PATCH', `/api/proposals/${propId}`, { token: seller.token, body: { action: 'aceite' } });
    ok('Prestador aceita → aceite', accept.status === 200 && accept.json?.status === 'aceite', `status=${accept.status}`);
    const clientAnswer = await api('PATCH', `/api/proposals/${propId}`, { token: buyer.token, body: { action: 'cancelada' } });
    ok('Cliente não re-responde proposta fechada → 409/403', clientAnswer.status === 409 || clientAnswer.status === 403, `status=${clientAnswer.status}`);

    /* ── 6. Config / MoMenu (ponto 9) ── */
    console.log('\n━━━ Config + MoMenu (ponto 9) ━━━');
    const cfg = await api('GET', '/api/config');
    ok('/api/config devolve momenuEnabled', cfg.status === 200 && typeof cfg.json?.momenuEnabled === 'boolean');
    ok('Sem MOMENU_API_KEY → momenuEnabled=false', cfg.json?.momenuEnabled === false);
    // Encomenda PENDENTE para testar a rota de pagamento (pagas → 400)
    const pendingOrder = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, user_id, payment_method)
      VALUES ('Comprador Fase6', '+244900000000', ${buyerEmail},
              ${JSON.stringify([{ id: productId, name: 'E2E F6 Ebook', price_kz: 1000, quantity: 1, seller_id: seller.user.id }])}::jsonb,
              1000, 'pendente', 'retirada', ${buyer.user.id}, 'momenu')
      RETURNING id
    `)[0];
    const pay = await api('POST', '/api/payments/momenu', { token: buyer.token, body: { order_id: Number(pendingOrder.id) } });
    ok('Pagamento MoMenu sem chave → 503', pay.status === 503, `status=${pay.status}`);
    await sql`DELETE FROM orders WHERE id = ${Number(pendingOrder.id)}`;

    /* ── 7. PWA (ponto 10) ── */
    console.log('\n━━━ PWA (ponto 10) ━━━');
    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    ok('/manifest.webmanifest servido', manifest.status === 200);
    const manifestBody = await manifest.json();
    ok('Manifest com ícones e nome AngoStart', Array.isArray(manifestBody.icons) && /AngoStart/.test(manifestBody.name ?? ''));
    const sw = await fetch(`${BASE}/sw.js`);
    ok('/sw.js servido', sw.status === 200);

    /* ── 8. Privacidade do catálogo (ponto 3) ── */
    console.log('\n━━━ Privacidade de produtos (ponto 3) ━━━');
    const pubList = await api('GET', '/api/products');
    const pubItem = pubList.json?.products?.find((p) => p.id === productId);
    ok('Catálogo público sem file_url nem stock', pubItem && !('file_url' in pubItem) && !('stock' in pubItem) && pubItem.available === true);
    const pubDetail = await api('GET', `/api/products/${productId}`);
    ok('Detalhe público sem file_url/telefone, com available', pubDetail.json?.product && !('file_url' in pubDetail.json.product) && !('seller_telefone' in pubDetail.json.product) && pubDetail.json.product.available === true);
    const ownerDetail = await api('GET', `/api/products/${productId}`, { token: seller.token });
    ok('Dono vê o produto completo (stock/file_url)', ownerDetail.json?.product && 'file_url' in ownerDetail.json.product && 'stock' in ownerDetail.json.product);
  } finally {
    /* ── Limpeza ── */
    await sql`DELETE FROM wallet_transactions WHERE user_id IN (SELECT id FROM users WHERE email IN (${sellerEmail}, ${buyerEmail}))`;
    await sql`DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE email IN (${sellerEmail}, ${buyerEmail}))`;
    await sql`DELETE FROM disputes WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email IN (${sellerEmail}, ${buyerEmail})))`;
    await sql`DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email IN (${sellerEmail}, ${buyerEmail}))`;
    await sql`DELETE FROM proposals WHERE client_id IN (SELECT id FROM users WHERE email = ${buyerEmail}) OR provider_id IN (SELECT id FROM users WHERE email = ${sellerEmail})`;
    await sql`DELETE FROM products WHERE user_id IN (SELECT id FROM users WHERE email = ${sellerEmail})`;
    await sql`DELETE FROM users WHERE email IN (${sellerEmail}, ${buyerEmail}, ${strangerEmail})`;
    console.log('\n(housekeeping) fixtures da Fase 6 removidas');
  }

  console.log(`\n━━━ Resultado: ${pass} passaram, ${fail} falharam ━━━`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
