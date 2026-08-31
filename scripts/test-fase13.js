#!/usr/bin/env node
/**
 * AngoStart — Testes E2E da FASE 13 (contra build de produção).
 *
 * Cobre o prazo de carência de 30 dias do KYC + supervisão do admin:
 *  1. Registo de vendedor sem documento → kyc_deadline = +30 dias
 *  2. Dentro da carência publica normalmente (201)
 *  3. Cron: 401 sem segredo (quando CRON_SECRET configurada) / 200 com
 *  4. Simular 30 dias (kyc_deadline no passado + cron) → kyc_status='overdue'
 *     + kyc_overdue_notified_at carimbado; 2.ª corrida NÃO re-notifica
 *  5. Overdue NÃO publica → 403 KYC_OVERDUE
 *  6. Admin: fila mostra overdue (stats + lista); «avisar» reenvia;
 *     «aceitar_justificacao» → not_submitted + prazo novo + publica 201
 *  7. Ações de supervisão rejeitam alvo não-overdue → 400
 *  8. Vendedor overdue submete documento → pending (prazo NULL) → publica
 *     → admin aprova → selo azul (is_verified_bi=TRUE)
 *  9. Pendente com prazo vencido NÃO é marcado overdue (quem submeteu
 *     cumpriu a carência — justiça do modelo)
 * 10. «Bloquear conta» → blocked=TRUE → token deixa de funcionar (401)
 *
 * Uso:
 *   DATABASE_URL=postgres://… CRON_SECRET=<segredo-da-servidor> \
 *   BASE_URL=http://localhost:3111 node scripts/test-fase13.js
 *
 * Faz cleanup automático dos dados de teste no fim (incluindo a conta
 * admin_limitado temporária criada por SQL).
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3111';
const CRON_SECRET = process.env.CRON_SECRET || '';

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const RUN = crypto.randomBytes(4).toString('hex');
const PASS = 'F13!Segura@2026';
const mk = (name) => ({
  name: `${name} ${RUN}`,
  email: `fase13.${name.toLowerCase().replace(/ /g, '_')}.${RUN}@test.ao`,
  pass: PASS,
});
const VENDEDOR = mk('Vendedor F13');
const VENDEDOR2 = mk('Vendedor2 F13');
const VENDEDOR3 = mk('Vendedor3 F13');
const ADMIN = mk('AdminTmp F13');
const IP_V = `10.13.${RUN.charCodeAt(0)}.${RUN.charCodeAt(1) % 254}`;
const IP_V2 = `10.13.${RUN.charCodeAt(2)}.${RUN.charCodeAt(3) % 254}`;
const IP_V3 = `10.13.${RUN.charCodeAt(4)}.${RUN.charCodeAt(5) % 254}`;
const IP_A = `10.13.${RUN.charCodeAt(6)}.${RUN.charCodeAt(7) % 254}`;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function ok(label, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ❌ ${label} ${extra ? `— ${extra}` : ''}`);
  }
}
function skip(label, why) {
  skipped += 1;
  console.log(`  ⏭️  SKIP ${label} — ${why}`);
}
function section(n, title) {
  console.log(`\n━━━ ${n} · ${title} ━━━`);
}

async function api(path, { method = 'GET', token, cronSecret, body, ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { status: 0, json: {}, error: String(e) };
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* html/empty */
  }
  return { status: res.status, json, headers: res.headers };
}

/** Prazo em dias a partir de agora (frazione; negativo = passado; NULL = sem prazo). */
async function deadlineDaysFromNow(userId) {
  const rows = await sql`
    SELECT EXTRACT(EPOCH FROM (kyc_deadline - NOW())) / 86400.0 AS dias
    FROM users WHERE id = ${userId} LIMIT 1`;
  const raw = rows[0]?.dias;
  if (raw === null || raw === undefined) return null;
  return Number(raw);
}

/** Põe o prazo no passado (simula a passagem dos 30 dias). */
async function expireDeadline(userId, daysAgo = 1) {
  await sql`
    UPDATE users SET kyc_deadline = NOW() - ${`${daysAgo} days`}::interval
    WHERE id = ${userId}`;
}

const reg = { users: [], products: [] };

async function registerSeller(body, ip) {
  const res = await api('/api/auth/register/vendedor', { method: 'POST', body, ip });
  if (res.status === 201 && res.json.user) {
    reg.users.push(res.json.user.id);
  }
  return res;
}

async function main() {
  /* ── 0. Saúde do servidor ── */
  section(0, 'Saúde');
  const health = await api('/api/config');
  ok('Servidor responde', health.status === 200 || health.status === 404, `status=${health.status}`);

  /* ── 1. Registo sem documento → prazo de 30 dias ── */
  section(1, 'Registo define kyc_deadline = NOW() + 30 dias');
  const v1 = await registerSeller(
    {
      name: VENDEDOR.name,
      email: VENDEDOR.email,
      password: VENDEDOR.pass,
      telefone: '958176900',
      role: 'criador',
      bio: 'Vendedor de testes da Fase 13 sem documento.',
    },
    IP_V
  );
  ok('Registo sem documento → 201', v1.status === 201, `status=${v1.status} ${JSON.stringify(v1.json).slice(0, 120)}`);
  ok('kyc_status = not_submitted', v1.json.user?.kyc_status === 'not_submitted', `got=${v1.json.user?.kyc_status}`);
  const UID1 = v1.json.user?.id;
  const TOKEN_V1 = v1.json.token;
  const dias1 = UID1 ? await deadlineDaysFromNow(UID1) : null;
  ok(
    'kyc_deadline ≈ +30 dias (29.9–30.1)',
    dias1 !== null && dias1 > 29.9 && dias1 < 30.1,
    `dias=${dias1}`
  );

  const v2 = await registerSeller(
    {
      name: VENDEDOR2.name,
      email: VENDEDOR2.email,
      password: VENDEDOR2.pass,
      telefone: '958176902',
      role: 'criador',
      bio: 'Vendedor 2 da Fase 13 — submete documento no fim.',
    },
    IP_V2
  );
  ok('Registo vendedor 2 → 201', v2.status === 201, `status=${v2.status}`);
  const UID2 = v2.json.user?.id;
  const TOKEN_V2 = v2.json.token;

  /* ── 2. Dentro da carência publica ── */
  section(2, 'Dentro da carência publica normalmente (núcleo Fase 13)');
  const pub1 = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F13 carência ${RUN}`,
      description: 'Produto publicado dentro da carência de 30 dias.',
      price: 5000,
      type: 'produto_fisico',
    },
  });
  ok('not_submitted dentro do prazo publica → 201', pub1.status === 201, `status=${pub1.status} ${JSON.stringify(pub1.json).slice(0, 120)}`);
  if (pub1.json.product?.id) reg.products.push(pub1.json.product.id);

  /* ── 3. Segurança do cron ── */
  section(3, 'Cron protegido por CRON_SECRET');
  if (CRON_SECRET) {
    const noTok = await api('/api/cron/check-kyc-deadline', { method: 'POST', ip: IP_A });
    ok('Cron sem token → 401', noTok.status === 401, `status=${noTok.status}`);
    const badTok = await api('/api/cron/check-kyc-deadline', { method: 'POST', cronSecret: 'errado', ip: IP_A });
    ok('Cron com token errado → 401', badTok.status === 401, `status=${badTok.status}`);
  } else {
    skip('Cron sem token → 401', 'CRON_SECRET não definida no servidor de teste (modo dev permite)');
  }
  const cronOk = await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  ok('Cron autorizado → 200', cronOk.status === 200, `status=${cronOk.status} ${JSON.stringify(cronOk.json).slice(0, 120)}`);
  ok('Cron devolve contadores', typeof cronOk.json.analisados === 'number' && typeof cronOk.json.marcados === 'number');

  /* ── 4. Simular passagem de 30 dias → overdue ── */
  section(4, 'Prazo expirado → overdue (via cron)');
  await expireDeadline(UID1, 1);
  const cron1 = await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  ok('Cron corre → 200', cron1.status === 200, `status=${cron1.status}`);
  ok('Cron marcou ≥ 1 overdue', (cron1.json.marcados ?? 0) >= 1, JSON.stringify(cron1.json).slice(0, 140));

  const db1 = await sql`SELECT kyc_status, kyc_overdue_notified_at::text FROM users WHERE id = ${UID1} LIMIT 1`;
  ok('DB: kyc_status = overdue', db1[0]?.kyc_status === 'overdue', `got=${db1[0]?.kyc_status}`);
  ok('DB: aviso carimbado (kyc_overdue_notified_at)', Boolean(db1[0]?.kyc_overdue_notified_at));

  /* 2.ª corrida: idempotente, sem re-notificação */
  const cron2 = await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  const db1b = await sql`SELECT kyc_overdue_notified_at::text FROM users WHERE id = ${UID1} LIMIT 1`;
  ok(
    '2.ª corrida não re-notifica (mesmo carimbo)',
    cron2.status === 200 && db1b[0]?.kyc_overdue_notified_at === db1[0]?.kyc_overdue_notified_at,
    `notificados=${cron2.json.notificados}`
  );

  /* ── 5. Overdue não publica ── */
  section(5, 'Overdue bloqueado de publicar');
  const pubOver = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F13 bloqueado ${RUN}`,
      description: 'Tentativa de publicar com prazo expirado — deve falhar.',
      price: 9000,
      type: 'produto_fisico',
    },
  });
  ok('Overdue NÃO publica → 403 KYC_OVERDUE', pubOver.status === 403 && pubOver.json.code === 'KYC_OVERDUE', `status=${pubOver.status} code=${pubOver.json.code}`);

  /* ── 6. Admin: fila + supervisão ── */
  section(6, 'Admin — fila de supervisão e ações');
  const adminHash = await bcrypt.hash(ADMIN.pass, 10);
  const adminIns = await sql`
    INSERT INTO users (name, email, password_hash, role, username, kyc_status, is_verified_bi, must_change_password)
    VALUES (${ADMIN.name}, ${ADMIN.email}, ${adminHash}, 'admin_limitado', ${'admintmp' + RUN}, 'none', FALSE, FALSE)
    RETURNING id`;
  const adminId = adminIns[0]?.id;
  reg.users.push(adminId);
  const adminLogin = await api('/api/auth/login', { method: 'POST', ip: IP_A, body: { email: ADMIN.email, password: ADMIN.pass } });
  ok('Admin temporário entra (200)', adminLogin.status === 200, `status=${adminLogin.status}`);
  const TOKEN_ADMIN = adminLogin.json.token;

  const fila = await api('/api/admin/kyc', { token: TOKEN_ADMIN, ip: IP_A });
  ok('Fila KYC → 200', fila.status === 200, `status=${fila.status}`);
  const overdueNaFila = (fila.json.overdue ?? []).find((p) => p.id === UID1);
  ok('Vendedor overdue aparece na fila de supervisão', Boolean(overdueNaFila));
  ok('Stats.overdue ≥ 1', (fila.json.stats?.overdue ?? 0) >= 1, `stats=${JSON.stringify(fila.json.stats)}`);

  /* Ações de supervisão exigem alvo overdue */
  const avisarNaoOverdue = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID2, action: 'avisar' },
  });
  ok('«Avisar» em não-overdue → 400', avisarNaoOverdue.status === 400, `status=${avisarNaoOverdue.status}`);
  const justNaoOverdue = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID2, action: 'aceitar_justificacao' },
  });
  ok('«Aceitar justificação» em não-overdue → 400', justNaoOverdue.status === 400, `status=${justNaoOverdue.status}`);

  /* Reenviar aviso */
  const avisar = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID1, action: 'avisar' },
  });
  const dbAvisado = await sql`SELECT kyc_overdue_notified_at::text FROM users WHERE id = ${UID1} LIMIT 1`;
  ok(
    '«Reenviar aviso» → 200 + carimbo atualizado',
    avisar.status === 200 && avisar.json.ok === true && dbAvisado[0]?.kyc_overdue_notified_at !== db1[0]?.kyc_overdue_notified_at,
    `status=${avisar.status}`
  );

  /* Aceitar justificação → volta a publicar */
  const justificar = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID1, action: 'aceitar_justificacao', note: 'Documento roubado — novo em emissão.' },
  });
  ok('«Aceitar justificação» → 200 + not_submitted', justificar.status === 200 && justificar.json.kyc_status === 'not_submitted', `status=${justificar.status} ${JSON.stringify(justificar.json).slice(0, 140)}`);
  const diasJust = await deadlineDaysFromNow(UID1);
  ok('Novo prazo ≈ +30 dias', diasJust !== null && diasJust > 29.9 && diasJust < 30.1, `dias=${diasJust}`);
  const dbJust = await sql`SELECT kyc_overdue_notified_at::text FROM users WHERE id = ${UID1} LIMIT 1`;
  ok('Marca de aviso limpa para novo ciclo', dbJust[0]?.kyc_overdue_notified_at === null);

  const pubJust = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F13 justificado ${RUN}`,
      description: 'Publicação desbloqueada após aceitação da justificação.',
      price: 12000,
      type: 'produto_fisico',
    },
  });
  ok('Após justificação publica → 201', pubJust.status === 201, `status=${pubJust.status}`);
  if (pubJust.json.product?.id) reg.products.push(pubJust.json.product.id);

  /* ── 7. Overdue submete documento → pending → aprovação → selo ── */
  section(7, 'Overdue submete documento → pending → selo azul');
  await expireDeadline(UID1, 1);
  const cron3 = await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  ok('Vendedor volta a overdue (2.º ciclo)', (cron3.json.marcados ?? 0) >= 1, JSON.stringify(cron3.json).slice(0, 120));

  const subOver = await api('/api/kyc/submit', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      kyc_document_url: `/api/kyc/document/${UID1}/1700000003000-bi_f13.png`,
      kyc_document_type: 'bi',
      birth_date: '1998-07-15',
    },
  });
  ok('Overdue submete documento → pending', (subOver.status === 200 || subOver.status === 201) && subOver.json.kyc_status === 'pending', `status=${subOver.status}`);
  const diasSub = await deadlineDaysFromNow(UID1);
  ok('Submissão limpa o prazo (kyc_deadline = NULL)', diasSub === null, `dias=${diasSub}`);

  const pubPend = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F13 reenviado ${RUN}`,
      description: 'Publicação desbloqueada após submissão do documento.',
      price: 15000,
      type: 'produto_fisico',
    },
  });
  ok('Pending publica → 201', pubPend.status === 201, `status=${pubPend.status} code=${pubPend.json.code}`);
  if (pubPend.json.product?.id) reg.products.push(pubPend.json.product.id);

  /* Pendente com prazo NULL NÃO é marcado overdue (quem submeteu cumpriu
     a carência — o cron só atinge quem tem prazo NÃO-nulo e vencido). */
  section(8, 'Pendente não é punido pelo cron (prazo já limpo pela submissão)');
  const cron4 = await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  const dbPend = await sql`SELECT kyc_status, kyc_deadline::text FROM users WHERE id = ${UID1} LIMIT 1`;
  ok(
    'Cron NÃO marca quem já submeteu (continua pending, prazo NULL)',
    cron4.status === 200 && dbPend[0]?.kyc_status === 'pending' && dbPend[0]?.kyc_deadline === null,
    `got=${dbPend[0]?.kyc_status} deadline=${dbPend[0]?.kyc_deadline}`
  );

  const aprova = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID1, action: 'aprovar' },
  });
  ok('Aprovação → verified + is_verified_bi=true', aprova.status === 200 && aprova.json.kyc_status === 'verified' && aprova.json.is_verified_bi === true, `status=${aprova.status}`);
  const loginSelo = await api('/api/auth/login', {
    method: 'POST',
    ip: IP_V,
    body: { email: VENDEDOR.email, password: VENDEDOR.pass },
  });
  ok('Selo azul exposto no login', loginSelo.json.user?.is_verified_bi === true && loginSelo.json.user?.kyc_status === 'verified');

  /* ── 9. Vendedor 2: perfil expõe prazo (countdown) ── */
  section(9, 'Perfil expõe kyc_deadline para o countdown');
  const meV2 = await api('/api/perfil/kyc', { token: TOKEN_V2, ip: IP_V2 });
  ok('GET /api/perfil/kyc devolve kyc_deadline', meV2.status === 200 && Boolean(meV2.json.kyc_deadline), `deadline=${meV2.json.kyc_deadline}`);
  ok('Vendedor 2 dentro da carência (dias > 29)', meV2.json.kyc_deadline && (await deadlineDaysFromNow(UID2)) > 29.9);

  /* ── 10. Bloquear conta ── */
  section(10, 'Admin bloqueia conta overdue (impede login/vendas)');
  const v3 = await registerSeller(
    {
      name: VENDEDOR3.name,
      email: VENDEDOR3.email,
      password: VENDEDOR3.pass,
      telefone: '958176903',
      role: 'criador',
      bio: 'Vendedor 3 — alvo do bloqueio.',
    },
    IP_V3
  );
  const UID3 = v3.json.user?.id;
  const TOKEN_V3 = v3.json.token;
  await expireDeadline(UID3, 1);
  await api('/api/cron/check-kyc-deadline', {
    method: 'POST',
    ...(CRON_SECRET ? { cronSecret: CRON_SECRET } : {}),
    ip: IP_A,
  });
  const bloqueia = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: UID3, action: 'bloquear', note: 'Reincidência — prazo expirado há 1 dia e sem resposta.' },
  });
  ok('«Bloquear conta» → 200', bloqueia.status === 200 && bloqueia.json.ok === true, `status=${bloqueia.status}`);
  const dbBloq = await sql`SELECT blocked::boolean FROM users WHERE id = ${UID3} LIMIT 1`;
  ok('DB: blocked = TRUE', dbBloq[0]?.blocked === true);
  const pubBloq = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V3,
    ip: IP_V3,
    body: {
      name: `Produto F13 bloqueado ${RUN}`,
      description: 'Tentativa de publicar com conta bloqueada.',
      price: 3000,
      type: 'produto_fisico',
    },
  });
  ok('Conta bloqueada: token deixa de publicar → 401', pubBloq.status === 401, `status=${pubBloq.status}`);
  const loginBloq = await api('/api/auth/login', {
    method: 'POST',
    ip: IP_V3,
    body: { email: VENDEDOR3.email, password: VENDEDOR3.pass },
  });
  ok('Login de conta bloqueada → 403', loginBloq.status === 403, `status=${loginBloq.status}`);

  /* ── Cleanup ── */
  section('F', 'Cleanup');
  await cleanup();
  console.log('  🧹 Dados de teste removidos.');

  /* ── Resumo ── */
  console.log('\n════════════════════════════════════════');
  console.log(`📊 FASE 13 — ${passed} PASS · ${failed} FAIL · ${skipped} SKIP`);
  if (failed > 0) {
    console.log('Falhas:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('🎉 Fase 13: prazo de carência + supervisão 100% validado.');
}

async function cleanup() {
  const uids = reg.users.filter(Boolean).join(',');
  const pids = reg.products.filter(Boolean).join(',');
  const steps = [];
  if (uids) steps.push(`DELETE FROM notifications WHERE user_id IN (${uids})`);
  steps.push(`DELETE FROM notifications WHERE title IN ('Novo documento KYC para rever', 'Novo documento KYC para rever — AngoStart') AND body LIKE '%Vendedor F13 ${RUN}%'`);
  steps.push(`DELETE FROM notifications WHERE title = 'Prazo de verificação de identidade expirou' AND user_id IN (${uids || '0'})`);
  if (uids) steps.push(`DELETE FROM wallet_transactions WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM wallets WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM push_subscriptions WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM store_followers WHERE user_id IN (${uids}) OR store_id IN (SELECT id FROM stores WHERE owner_id IN (${uids}))`);
  if (pids) steps.push(`DELETE FROM reviews WHERE product_id IN (${pids})`);
  if (uids) steps.push(`DELETE FROM reviews WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM orders WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM stores WHERE owner_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM affiliates WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM seller_points WHERE user_id IN (${uids})`);
  if (uids) steps.push(`DELETE FROM user_badges WHERE user_id IN (${uids})`);
  if (pids) steps.push(`DELETE FROM products WHERE id IN (${pids})`);
  if (uids) steps.push(`DELETE FROM users WHERE id IN (${uids})`);
  for (const q of steps) {
    try {
      await sql.query(q);
    } catch (e) {
      console.warn(`  ⚠️ cleanup: ${e.message.slice(0, 80)}`);
    }
  }
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e);
  cleanup()
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
});
