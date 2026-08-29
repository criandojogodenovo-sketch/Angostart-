/**
 * AngoStart — Testes E2E da Fase 7
 *
 * Cobre:
 *  1. Propostas robustas (preço/prazo, contrapropostas, geração de pedido)
 *  2. Web Push (rotas subscribe/unsubscribe + validação)
 *  3. Gamificação (pontos, selos, níveis)
 *  4. Comissões flexíveis (taxas, overrides, auditoria, integração escrow)
 *  5. Segurança (401 sem sessão, 403 sem permissão, validação de inputs)
 *
 * Executar:
 *   1) npm run build && node node_modules/next/dist/bin/next start -p 3459
 *   2) node --env-file=.env scripts/test-fase7.js
 */

const { neon } = require('@neondatabase/serverless');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3459';

function dbUrl() {
  const candidates = [process.env.NEON_DATABASE_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    if (c && c.startsWith('postgres')) return c;
  }
  throw new Error('DATABASE_URL em falta');
}
const sql = neon(dbUrl());

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, data: json };
}

async function register(name, email, password, role, extra = {}) {
  const endpoint = role === 'cliente' ? '/api/auth/register/cliente' : '/api/auth/register/vendedor';
  const res = await api('POST', endpoint, {
    body: { name, email, password, telefone: '+244923000999', role, ...extra },
  });
  if (res.status === 201 && res.data?.token) return res.data.token;
  const login = await api('POST', '/api/auth/login', { body: { email, password } });
  return login.data?.token ?? null;
}

const uniq = Date.now();
const CLIENT = {
  name: 'Cliente Fase 7',
  email: `f7cliente${uniq}@teste.ao`,
  password: 'TesteFase7!x',
  telefone: '+244923000111',
};
const SELLER = {
  name: 'Vendedor Fase 7',
  email: `f7vendedor${uniq}@teste.ao`,
  password: 'TesteFase7!x',
  telefone: '+244923000222',
  role: 'prestador_remoto',
  bio: 'Prestador remoto de testes da Fase 7 com experiência comprovada.',
  especialidade: 'design',
};

const cleanups = [];

async function main() {
  console.log('━━━ Fase 7 — verificação de código-fonte ━━━');

  const fs = require('fs');
  const pushLib = fs.readFileSync('src/lib/push.ts', 'utf8');
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  const notif = fs.readFileSync('src/lib/notifications.ts', 'utf8');
  const wallet = fs.readFileSync('src/lib/wallet.ts', 'utf8');
  const comm = fs.readFileSync('src/lib/commissions.ts', 'utf8');
  const game = fs.readFileSync('src/lib/gamification-server.ts', 'utf8');
  const propPatch = fs.readFileSync('src/app/api/proposals/[id]/route.ts', 'utf8');

  check('lib/push.ts usa server-only', pushLib.includes("import 'server-only'"));
  check('lib/push.ts configura VAPID (setVapidDetails)', pushLib.includes('setVapidDetails'));
  check('push remove subscriptions mortas (410/404)', pushLib.includes('statusCode === 404'));
  check('sw.js trata evento push', sw.includes("addEventListener('push'"));
  check('sw.js trata notificationclick', sw.includes("addEventListener('notificationclick'"));
  check('sino (bell) dispara web push', notif.includes('sendWebPushToUser'));
  check('escrow usa taxa efetiva (overrides)', wallet.includes('getEffectiveCommissionPercent'));
  check('pedido pago → push cliente+vendedor + pontos', wallet.includes('Venda realizada'));
  check('comissões: máx 50%', comm.includes('MAX_COMMISSION_PERCENT = 50'));
  check('comissões: auditoria em toda a alteração', comm.includes('commission_audit'));
  check('gamificação: níveis bronze→platina', fs.readFileSync('src/lib/gamification.ts', 'utf8').includes("key: 'platina'"));
  check('gamificação: avaliação de selos automática', game.includes('evaluateBadges'));
  check('proposta aceite gera order', propPatch.includes("INSERT INTO orders"));
  check('contrapropor alterna a vez (last_offer_by)', propPatch.includes('last_offer_by'));
  check('vercel.json com cron gamification', fs.readFileSync('vercel.json', 'utf8').includes('/api/cron/gamification'));

  console.log('━━━ Fase 7 — schema da base de dados ━━━');

  const tables = ['proposal_counters', 'push_subscriptions', 'badges', 'user_badges', 'seller_points', 'commission_rates', 'seller_commission_overrides', 'commission_audit'];
  for (const t of tables) {
    const rows = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${t}
    `;
    check(`tabela ${t} existe`, Number(rows[0]?.n) === 1);
  }

  const seededBadges = await sql`SELECT count(*)::int AS n FROM badges`;
  check('8 selos semeados', Number(seededBadges[0].n) === 8, `n=${seededBadges[0].n}`);

  const seededRates = await sql`SELECT scope, percent::float8 AS p FROM commission_rates ORDER BY scope`;
  check(
    'taxas iniciais 5/10/6.5',
    seededRates.length === 3 &&
      Number(seededRates.find((r) => r.scope === 'produto')?.p) === 5 &&
      Number(seededRates.find((r) => r.scope === 'servico_domicilio')?.p) === 10 &&
      Number(seededRates.find((r) => r.scope === 'freelancer')?.p) === 6.5
  );

  console.log('━━━ Fase 7 — fluxo de propostas (E2E) ━━━');

  // Registo de utilizadores
  const clientToken = await register(CLIENT.name, CLIENT.email, CLIENT.password, 'cliente');
  check('cliente registado', Boolean(clientToken));
  const sellerToken = await register(
    SELLER.name,
    SELLER.email,
    SELLER.password,
    SELLER.role,
    { bio: SELLER.bio, especialidade: SELLER.especialidade }
  );
  check('vendedor registado', Boolean(sellerToken));
  if (!clientToken || !sellerToken) throw new Error('Sem tokens — abortar');

  const clientMe = await api('GET', '/api/auth/me', { token: clientToken });
  const sellerMe = await api('GET', '/api/auth/me', { token: sellerToken });
  const clientId = clientMe.data?.user?.id;
  const sellerId = sellerMe.data?.user?.id;
  check('ids de utilizador obtidos', Boolean(clientId && sellerId));

  // KYC do vendedor (Fase 6): BI obrigatório para publicar — preenchido direto na BD
  await sql`UPDATE users SET bi_number = ${'00' + uniq + 'LA040'} WHERE id = ${sellerId}`;

  // Vendedor publica um serviço remoto
  const prodRes = await api('POST', '/api/products', {
    token: sellerToken,
    body: {
      name: `Serviço Negociável F7 ${uniq}`,
      description: 'Serviço remoto de teste para negociação de propostas da Fase 7.',
      price_kz: 20000,
      type: 'servico_remoto',
    },
  });
  check('vendedor publica serviço', prodRes.status === 201, `status=${prodRes.status} ${JSON.stringify(prodRes.data)}`);
  const productId = prodRes.data?.product?.id;

  // Cliente envia proposta com preço e prazo
  const propRes = await api('POST', '/api/proposals', {
    token: clientToken,
    body: {
      service_id: productId,
      description: 'Preciso deste serviço com um escopo ajustado ao meu orçamento.',
      price_kz: 15000,
      deadline_days: 7,
    },
  });
  check('cliente envia proposta (preço+prazo)', propRes.status === 201, `status=${propRes.status}`);
  const proposalId = propRes.data?.proposal?.id;

  const propRow = (await sql`SELECT price_kz::float8 AS p, deadline_days AS d, last_offer_by FROM proposals WHERE id = ${proposalId}`)[0];
  check('proposta guarda preço e prazo', Number(propRow?.p) === 15000 && Number(propRow?.d) === 7);
  check('proposta nasce com oferta do cliente na mesa', Number(propRow?.last_offer_by) === Number(clientId));

  // Regras de segurança
  const anonRes = await api('POST', '/api/proposals', { body: { service_id: productId, description: 'x'.repeat(30), price_kz: 1000 } });
  check('proposta sem sessão → 401', anonRes.status === 401);
  const selfRes = await api('POST', '/api/proposals', {
    token: sellerToken,
    body: { service_id: productId, description: 'Tento propor no meu próprio serviço.', price_kz: 1000 },
  });
  check('auto-proposta bloqueada', selfRes.status === 400);
  const badPrice = await api('POST', '/api/proposals', {
    token: clientToken,
    body: { service_id: productId, description: 'Preço fora do intervalo permitido pelo sistema.', price_kz: 10 },
  });
  check('preço inválido rejeitado', badPrice.status === 400);

  // Vendedor não pode aceitar a própria… quer dizer: oferta vigente é do cliente, vendedor contrapropõe
  const ownAccept = await api('PATCH', `/api/proposals/${proposalId}`, {
    token: clientToken,
    body: { action: 'aceite' },
  });
  check('autor não aceita a própria oferta (409/403)', ownAccept.status === 409 || ownAccept.status === 403);

  const counterRes = await api('PATCH', `/api/proposals/${proposalId}`, {
    token: sellerToken,
    body: { action: 'contrapropor', price_kz: 18000, deadline_days: 5, message: 'Consigo fazer por 18.000 Kz em 5 dias.' },
  });
  check('vendedor contrapropõe', counterRes.status === 200, `status=${counterRes.status}`);

  const counterRow = (await sql`SELECT price_kz::float8 AS p, last_offer_by FROM proposals WHERE id = ${proposalId}`)[0];
  check('contraproposta atualiza termos', Number(counterRow?.p) === 18000 && Number(counterRow?.last_offer_by) === Number(sellerId));

  const counterTwice = await api('PATCH', `/api/proposals/${proposalId}`, {
    token: sellerToken,
    body: { action: 'contrapropor', price_kz: 19000 },
  });
  check('não contrapropõe 2× seguidas (409)', counterTwice.status === 409);

  // Histórico visível a ambas as partes
  const histClient = await api('GET', `/api/proposals/${proposalId}`, { token: clientToken });
  check('histórico com 2 rodadas (cliente)', (histClient.data?.history?.length ?? 0) === 2);
  const histSeller = await api('GET', `/api/proposals/${proposalId}`, { token: sellerToken });
  check('histórico visível ao vendedor', (histSeller.data?.history?.length ?? 0) === 2);
  const histAnon = await api('GET', `/api/proposals/${proposalId}`);
  check('histórico sem sessão → 401', histAnon.status === 401);

  // Cliente aceita a contraproposta → pedido gerado
  const acceptRes = await api('PATCH', `/api/proposals/${proposalId}`, {
    token: clientToken,
    body: { action: 'aceite' },
  });
  check('cliente aceita contraproposta', acceptRes.status === 200 && acceptRes.data?.ok === true, `status=${acceptRes.status}`);
  const orderId = acceptRes.data?.order_id;
  check('pedido gerado automaticamente', Boolean(orderId));

  const orderRow = (await sql`SELECT total_kz::float8 AS t, status, user_id, payment_method FROM orders WHERE id = ${orderId}`)[0];
  check('pedido com valor acordado (18.000 Kz)', Number(orderRow?.t) === 18000);
  check('pedido pertence ao cliente, aguarda pagamento', Number(orderRow?.user_id) === Number(clientId) && orderRow?.status === 'pendente');
  check('método de pagamento KWiK manual', orderRow?.payment_method === 'kwik');
  const proposalAfter = (await sql`SELECT status, order_id FROM proposals WHERE id = ${proposalId}`)[0];
  check('proposta marcada aceite + ligada ao pedido', proposalAfter?.status === 'aceite' && Number(proposalAfter?.order_id) === Number(orderId));

  const doubleAccept = await api('PATCH', `/api/proposals/${proposalId}`, {
    token: sellerToken,
    body: { action: 'aceite' },
  });
  check('proposta não é aceite 2× (409)', doubleAccept.status === 409);

  console.log('━━━ Fase 7 — Web Push ━━━');

  const subAnon = await api('POST', '/api/push/subscribe', {
    body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'x'.repeat(88), auth: 'y'.repeat(24) } } },
  });
  check('subscribe sem sessão → 401', subAnon.status === 401);

  const subBad = await api('POST', '/api/push/subscribe', {
    token: clientToken,
    body: { subscription: { endpoint: 'http://inseguro', keys: { p256dh: 'x', auth: 'y' } } },
  });
  check('subscription inválida → 400', subBad.status === 400);

  const subOk = await api('POST', '/api/push/subscribe', {
    token: clientToken,
    body: {
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/test-${uniq}`,
        keys: { p256dh: 'B'.repeat(88), auth: 'a'.repeat(24) },
      },
    },
  });
  check('subscription válida guardada', subOk.status === 201, `status=${subOk.status}`);
  const subDb = await sql`SELECT user_id FROM push_subscriptions WHERE endpoint = ${`https://fcm.googleapis.com/fcm/send/test-${uniq}`}`;
  check('subscription na BD ligada ao utilizador', Number(subDb[0]?.user_id) === Number(clientId));

  const unsubOther = await api('POST', '/api/push/unsubscribe', {
    token: sellerToken,
    body: { endpoint: `https://fcm.googleapis.com/fcm/send/test-${uniq}` },
  });
  const stillThere = await sql`SELECT 1 FROM push_subscriptions WHERE endpoint = ${`https://fcm.googleapis.com/fcm/send/test-${uniq}`}`;
  check('outro utilizador NÃO remove a subscription', stillThere.length === 1);

  const unsubOwn = await api('POST', '/api/push/unsubscribe', {
    token: clientToken,
    body: { endpoint: `https://fcm.googleapis.com/fcm/send/test-${uniq}` },
  });
  const gone = await sql`SELECT 1 FROM push_subscriptions WHERE endpoint = ${`https://fcm.googleapis.com/fcm/send/test-${uniq}`}`;
  check('dono remove a própria subscription', unsubOwn.data?.ok === true && gone.length === 0);

  console.log('━━━ Fase 7 — Gamificação + Comissões (E2E) ━━━');

  // Login admin (credenciais passadas por env — nunca no repositório)
  const adminEmail = process.env.ADMIN_EMAIL || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  let adminToken = null;
  if (adminEmail && adminPassword) {
    const adminLogin = await api('POST', '/api/auth/login', {
      body: { email: adminEmail, password: adminPassword },
    });
    adminToken = adminLogin.data?.token ?? null;
  }
  check('login admin para validação', Boolean(adminToken) || !adminEmail, adminToken ? '' : '(sem ADMIN_PASSWORD — validação direta na BD)');

  if (adminToken) {
    // 1. Comissões: taxas e overrides ANTES do pagamento (o escrow usa a taxa efetiva)
    const commAnon = await api('GET', '/api/admin/commissions', { token: sellerToken });
    check('comissões: vendedor não-admin → 403', commAnon.status === 403);

    const commAdmin = await api('GET', '/api/admin/commissions', { token: adminToken });
    check('admin lê taxas + relatório', commAdmin.status === 200 && Array.isArray(commAdmin.data?.rates));

    const ovRes = await api('POST', '/api/admin/commissions', {
      token: adminToken,
      body: { seller_id: sellerId, percent: 3 },
    });
    check('override individual aplicado (3%)', ovRes.data?.ok === true);

    const myRate = await api('GET', '/api/dashboard/commission', { token: sellerToken });
    check('vendedor vê a taxa individual', Number(myRate.data?.percent) === 3 && myRate.data?.source === 'override');

    // 2. Admin valida o pedido como pago → escrow com override 3% + push + gamificação
    const paidRes = await api('PATCH', `/api/admin/orders/${orderId}`, {
      token: adminToken,
      body: { status: 'pago' },
    });
    check('admin valida pedido como pago', paidRes.status === 200, `status=${paidRes.status} ${JSON.stringify(paidRes.data)}`);

    // 3. Validações de regras das taxas (após o pagamento, para o relatório)
    const rateTooHigh = await api('PATCH', '/api/admin/commissions', {
      token: adminToken,
      body: { scope: 'freelancer', percent: 80 },
    });
    check('taxa > 50% rejeitada', rateTooHigh.status === 400);

    const auditRows = await sql`SELECT count(*)::int AS n FROM commission_audit`;
    check('auditoria registou as alterações', Number(auditRows[0].n) >= 1, `n=${auditRows[0].n}`);

    // 4. Remove o override → vendedor volta à taxa da tabela (6.5% freelancer)
    await api('POST', '/api/admin/commissions', { token: adminToken, body: { seller_id: sellerId, percent: null } });
    const myRate2 = await api('GET', '/api/dashboard/commission', { token: sellerToken });
    check('override removido → volta à tabela (6.5%)', Number(myRate2.data?.percent) === 6.5, `p=${myRate2.data?.percent}`);
  } else {
    // Sem admin: marca pago na BD — escrow/pontos não correm (checks seguintes falham à vista)
    console.log('  (sem ADMIN_PASSWORD — a marcar pago na BD; efeitos colaterais não disparam)');
    await sql`UPDATE orders SET status = 'pago' WHERE id = ${orderId}`;
  }

  // Gamificação: pontos + selo primeira_venda (disparados pelo admin PATCH)
  const pointsRow = (await sql`SELECT points::int AS p FROM seller_points WHERE user_id = ${sellerId}`)[0];
  check('vendedor ganhou pontos com a venda (≥1)', Number(pointsRow?.p ?? 0) >= 1, `pontos=${pointsRow?.p}`);

  const badgeRow = await sql`
    SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ${sellerId} AND b.code = 'primeira_venda'
  `;
  check('selo primeira_venda atribuído', badgeRow.length > 0);

  const statsRes = await api('GET', '/api/dashboard/gamification', { token: sellerToken });
  check('GET gamification devolve nível+selos', statsRes.status === 200 && Boolean(statsRes.data?.level));
  check('nível calculado (bronze com poucos pontos)', statsRes.data?.level === 'bronze');
  check('primeira_venda no payload', (statsRes.data?.badges ?? []).some((b) => b.code === 'primeira_venda'));

  const gameAnon = await api('GET', '/api/dashboard/gamification');
  check('gamification sem sessão → 401', gameAnon.status === 401);

  // Escrow do pedido pago: comissão com override 3% → 540 Kz, líquido 17.460 Kz
  const escrowTx = await sql`
    SELECT commission_kz::float8 AS c, valor::float8 AS v, status
    FROM wallet_transactions
    WHERE order_id = ${orderId} AND user_id = ${sellerId} AND tipo = 'recebimento' LIMIT 1
  `;
  check('escrow criado para o vendedor', escrowTx.length === 1);
  if (adminToken) {
    check('comissão calculada com override (540 Kz)', Number(escrowTx[0]?.c) === 540, `c=${escrowTx[0]?.c}`);
    check('valor líquido bloqueado (17.460 Kz)', Number(escrowTx[0]?.v) === 17460, `v=${escrowTx[0]?.v}`);
  }

  console.log('━━━ Fase 7 — limpeza ━━━');
  await sql`DELETE FROM wallet_transactions WHERE order_id = ${orderId}`;
  await sql`DELETE FROM orders WHERE id = ${orderId}`;
  await sql`DELETE FROM proposals WHERE id = ${proposalId}`;
  await sql`DELETE FROM seller_points WHERE user_id = ${sellerId}`;
  await sql`DELETE FROM user_badges WHERE user_id = ${sellerId}`;
  await sql`DELETE FROM products WHERE id = ${productId}`;
  await sql`DELETE FROM commission_audit WHERE scope = 'override' AND seller_id = ${sellerId}`;
  await sql`DELETE FROM commission_audit WHERE scope = 'freelancer'`;
  await sql`UPDATE commission_rates SET percent = 6.5 WHERE scope = 'freelancer'`;
  await sql`DELETE FROM push_subscriptions WHERE user_id IN (${clientId}, ${sellerId})`;
  await sql`DELETE FROM notifications WHERE user_id IN (${clientId}, ${sellerId})`;
  await sql`DELETE FROM users WHERE id IN (${clientId}, ${sellerId})`;
  console.log('  ✓ dados de teste removidos');

  console.log('━━━ Fase 7 — RESULTADO ━━━');
  console.log(`  Passaram: ${passed} · Falharam: ${failed}`);
  if (failed > 0) {
    console.log('  Falhas:', failures.join(' | '));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro fatal nos testes:', err);
    process.exit(1);
  });
