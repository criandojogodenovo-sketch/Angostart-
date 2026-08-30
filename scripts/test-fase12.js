#!/usr/bin/env node
/**
 * AngoStart — Testes E2E da FASE 12 (contra build de produção).
 *
 * Cobre o KYC flexível orientado a fotos:
 *  1. Registo de vendedor SEM BI → conta criada (kyc_status='not_submitted')
 *  2. BI/nascimento inválidos quando preenchidos → 400
 *  3. Vendedor sem verificação PODE publicar (201) — núcleo da Fase 12
 *  4. Upload KYC: 401 sem auth, 400 com ficheiro não-imagem
 *  5. Submissão KYC: URL externo/estranho → 400; URL próprio → pending
 *  6. Documento privado: 401 sem sessão, 403 a terceiros
 *  7. Admin (via conta admin_limitado temporária): fila, aprovar, rejeitar
 *  8. Rejeitado → publicação 403 KYC_REJECTED; reenvio → desbloqueia;
 *     aprovação → selo (is_verified_bi=TRUE)
 *  9. Idade: admin vê alerta de data de nascimento em falta
 *
 * Uso:
 *   DATABASE_URL=postgres://… BASE_URL=http://localhost:3111 \
 *     node scripts/test-fase12.js
 *
 * Faz cleanup automático dos dados de teste no fim (incluindo a conta
 * admin_limitado temporária criada por SQL).
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3111';

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL (Neon) não definida.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const RUN = crypto.randomBytes(4).toString('hex');
const PASS = 'F12!Segura@2026';
const mk = (name) => ({
  name: `${name} ${RUN}`,
  email: `fase12.${name.toLowerCase().replace(/ /g, '_')}.${RUN}@test.ao`,
  pass: PASS,
});
const VENDEDOR = mk('Vendedor F12');
const VENDEDOR2 = mk('Vendedor2 F12');
const VENDEDOR_JOVEM = mk('Jovem F12');
const ADMIN = mk('AdminTmp F12');
const IP_V = `10.12.${RUN.charCodeAt(0)}.${RUN.charCodeAt(1) % 254}`;
const IP_V2 = `10.12.${RUN.charCodeAt(2)}.${RUN.charCodeAt(3) % 254}`;
const IP_A = `10.12.${RUN.charCodeAt(4)}.${RUN.charCodeAt(5) % 254}`;

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
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(path, { method = 'GET', token, body, ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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

/** PNG válido (assinatura + IHDR) para testes de upload. */
function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

/* IDs para cleanup */
const reg = { users: [], products: [], stores: [] };

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

  /* ── 1. Registo sem BI / sem nascimento ── */
  section(1, 'Registo de vendedor sem BI (novo fluxo)');
  const v1 = await registerSeller(
    {
      name: VENDEDOR.name,
      email: VENDEDOR.email,
      password: VENDEDOR.pass,
      telefone: '958176900',
      role: 'criador',
      bio: 'Vendedor de testes da Fase 12 sem BI indicado.',
    },
    IP_V
  );
  ok('Registo sem BI → 201', v1.status === 201, `status=${v1.status} ${JSON.stringify(v1.json).slice(0, 120)}`);
  ok('kyc_status = not_submitted', v1.json.user?.kyc_status === 'not_submitted', `got=${v1.json.user?.kyc_status}`);
  ok('Sem selo azul (is_verified_bi=false)', v1.json.user?.is_verified_bi === false);
  const TOKEN_V1 = v1.json.token;

  const vJovem = await api('/api/auth/register/vendedor', {
    method: 'POST',
    ip: IP_V2,
    body: {
      name: VENDEDOR_JOVEM.name,
      email: VENDEDOR_JOVEM.email,
      password: VENDEDOR_JOVEM.pass,
      telefone: '958176901',
      role: 'criador',
      bio: 'Tentativa com idade abaixo do mínimo.',
      birth_date: new Date(Date.now() - 14 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    },
  });
  ok('Idade 14 anos → 400', vJovem.status === 400, `status=${vJovem.status}`);

  const vBiInvalido = await api('/api/auth/register/vendedor', {
    method: 'POST',
    ip: IP_V2,
    body: {
      name: VENDEDOR_JOVEM.name,
      email: VENDEDOR_JOVEM.email,
      password: VENDEDOR_JOVEM.pass,
      telefone: '958176901',
      role: 'criador',
      bio: 'BI mal formado deve ser rejeitado.',
      bi_number: '123ABC',
    },
  });
  ok('BI inválido quando preenchido → 400', vBiInvalido.status === 400, `status=${vBiInvalido.status}`);

  const v2 = await registerSeller(
    {
      name: VENDEDOR2.name,
      email: VENDEDOR2.email,
      password: VENDEDOR2.pass,
      telefone: '958176902',
      role: 'criador',
      bio: 'Vendedor de testes 2 com data de nascimento válida.',
      birth_date: '1995-03-20',
    },
    IP_V2
  );
  ok('Registo com só nascimento (15+) → 201', v2.status === 201, `status=${v2.status}`);
  const TOKEN_V2 = v2.json.token;

  /* ── 2. Publicar sem verificação ── */
  section(2, 'Publicação sem verificação (núcleo Fase 12)');
  const pub1 = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F12 ${RUN}`,
      description: 'Produto de teste do vendedor sem verificação KYC.',
      price: 5000,
      type: 'produto_fisico',
    },
  });
  ok('not_submitted publica → 201', pub1.status === 201, `status=${pub1.status} ${JSON.stringify(pub1.json).slice(0, 120)}`);
  if (pub1.json.product?.id) reg.products.push(pub1.json.product.id);

  /* ── 3. Upload KYC ── */
  section(3, 'Upload de documento (POST /api/kyc/upload)');
  const upNoAuth = await fetch(`${BASE}/api/kyc/upload`, { method: 'POST' });
  ok('Upload sem sessão → 401', upNoAuth.status === 401, `status=${upNoAuth.status}`);

  const upText = await fetch(`${BASE}/api/kyc/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_V1}`, 'Content-Type': 'multipart/form-data; boundary=X' },
    body: '--X\r\nContent-Disposition: form-data; name="file"; filename="doc.txt"\r\nContent-Type: text/plain\r\n\r\nisto nao e uma imagem\r\n--X--\r\n',
  });
  ok('Upload de ficheiro texto → 400', upText.status === 400, `status=${upText.status}`);

  const upPng = await fetch(`${BASE}/api/kyc/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_V1}` },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'documento.png');
      return fd;
    })(),
  });
  if (upPng.status === 503) {
    skip('Upload PNG válido (Blob indisponível localmente)', '503 — sem BLOB_READ_WRITE_TOKEN; validações 401/400 provadas acima; caminho positivo coberto em produção');
  } else {
    const upJson = await upPng.json().catch(() => ({}));
    ok('Upload PNG válido → 201 com URL /api/kyc/document/<meu-id>/', upPng.status === 201 && /^\/api\/kyc\/document\/\d+\/\d{13}-/.test(upJson.url || ''), `status=${upPng.status} url=${upJson.url}`);
  }

  /* ── 4. Submissão KYC ── */
  section(4, 'Submissão do documento (POST /api/kyc/submit)');
  const subNoUrl = await api('/api/kyc/submit', { method: 'POST', token: TOKEN_V1, ip: IP_V, body: {} });
  ok('Submissão sem URL → 400', subNoUrl.status === 400, `status=${subNoUrl.status}`);

  const subExterno = await api('/api/kyc/submit', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: { kyc_document_url: 'https://malicioso.example.com/bi.jpg' },
  });
  ok('URL externo → 400', subExterno.status === 400, `status=${subExterno.status}`);

  const subAlheia = await api('/api/kyc/submit', {
    method: 'POST',
    token: TOKEN_V2,
    ip: IP_V2,
    body: { kyc_document_url: `/api/kyc/document/${v1.json.user?.id ?? 99999}/1700000000000-doc.png` },
  });
  ok('URL de outro vendedor → 400', subAlheia.status === 400, `status=${subAlheia.status}`);

  const subPropria = await api('/api/kyc/submit', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      kyc_document_url: `/api/kyc/document/${v1.json.user?.id}/1700000000000-bi_foto.png`,
      kyc_document_type: 'bi',
    },
  });
  ok('URL próprio → 200/201 + pending', (subPropria.status === 200 || subPropria.status === 201) && subPropria.json.kyc_status === 'pending', `status=${subPropria.status} ${JSON.stringify(subPropria.json).slice(0, 140)}`);

  const mePend = await api('/api/perfil/kyc', { token: TOKEN_V1, ip: IP_V });
  ok('GET /api/perfil/kyc reflete pending + tipo bi', mePend.json.kyc_status === 'pending' && mePend.json.kyc_document_type === 'bi' && Boolean(mePend.json.kyc_document_url), JSON.stringify(mePend.json).slice(0, 160));

  /* ── 5. Publicar em pending ── */
  section(5, 'Publicação enquanto pending (pode vender)');
  const pubPend = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F12 pendente ${RUN}`,
      description: 'Segundo produto — vendedor com KYC pendente continua a vender.',
      price: 7500,
      type: 'produto_fisico',
    },
  });
  ok('pending publica → 201', pubPend.status === 201, `status=${pubPend.status}`);
  if (pubPend.json.product?.id) reg.products.push(pubPend.json.product.id);

  /* ── 6. Documento privado ── */
  section(6, 'Rota privada do documento (GET /api/kyc/document)');
  const docPath = `/api/kyc/document/${v1.json.user?.id}/1700000000000-bi_foto.png`;
  const docNoAuth = await fetch(`${BASE}${docPath}`);
  ok('Documento sem sessão → 401', docNoAuth.status === 401, `status=${docNoAuth.status}`);
  const docTerceiro = await fetch(`${BASE}${docPath}`, {
    headers: { Authorization: `Bearer ${TOKEN_V2}` },
  });
  ok('Documento a terceiro → 403', docTerceiro.status === 403, `status=${docTerceiro.status}`);
  const docDono = await fetch(`${BASE}${docPath}`, {
    headers: { Authorization: `Bearer ${TOKEN_V1}` },
  });
  /* Autenticação passou (não é 401/403): localmente sem Blob → 503;
     em produção com Blob e documento inexistente → 404 limpo. */
  ok('Dono autentica (404 sem blob local / 503 sem token)', docDono.status === 404 || docDono.status === 503, `status=${docDono.status}`);
  const docTraversal = await fetch(`${BASE}/api/kyc/document/..%2F..%2Fprodutos%2F1%2Fx.png`, {
    headers: { Authorization: `Bearer ${TOKEN_V1}` },
  });
  ok('Path traversal → 404 (sem exposição)', docTraversal.status === 404, `status=${docTraversal.status}`);

  /* ── 7. Admin: fila + aprovar/rejeitar ── */
  section(7, 'Admin — fila, rejeição, bloqueio, reenvio, aprovação');
  /* Conta admin_limitado TEMPORÁRIA criada por SQL (senha nunca commitada) */
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

  const filaSeller = await api('/api/admin/kyc', { token: TOKEN_V2, ip: IP_V2 });
  ok('Fila KYC com token de vendedor → 403', filaSeller.status === 403, `status=${filaSeller.status}`);

  const fila = await api('/api/admin/kyc', { token: TOKEN_ADMIN, ip: IP_A });
  ok('Fila KYC → 200', fila.status === 200, `status=${fila.status}`);
  const pendenteNaFila = (fila.json.pending ?? []).find((p) => p.id === v1.json.user?.id);
  ok('Vendedor pendente na fila com documento', Boolean(pendenteNaFila) && Boolean(pendenteNaFila.kyc_document_url), JSON.stringify(pendenteNaFila ?? {}).slice(0, 160));
  ok('Alerta sem data de nascimento presente', (fila.json.stats?.sem_data_nascimento ?? 0) >= 1, `stats=${JSON.stringify(fila.json.stats)}`);

  const rejeitarSemNota = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: v1.json.user?.id, action: 'rejeitar' },
  });
  ok('Rejeição sem motivo → 400', rejeitarSemNota.status === 400, `status=${rejeitarSemNota.status}`);

  const rejeita = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: {
      user_id: v1.json.user?.id,
      action: 'rejeitar',
      note: 'Foto ilegível — envia uma imagem nítida do documento.',
    },
  });
  ok('Rejeição → 200 + rejected', rejeita.status === 200 && rejeita.json.kyc_status === 'rejected', `status=${rejeita.status}`);

  const pubRej = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F12 bloqueado ${RUN}`,
      description: 'Tentativa de publicar com KYC rejeitado — deve falhar.',
      price: 9000,
      type: 'produto_fisico',
    },
  });
  ok('Rejeitado NÃO publica → 403 KYC_REJECTED', pubRej.status === 403 && pubRej.json.code === 'KYC_REJECTED', `status=${pubRej.status} code=${pubRej.json.code}`);

  const perfilRej = await api('/api/perfil/kyc', { token: TOKEN_V1, ip: IP_V });
  ok('Perfil mostra rejected + motivo', perfilRej.json.kyc_status === 'rejected' && (perfilRej.json.kyc_rejection_reason || '').includes('ilegível'), JSON.stringify(perfilRej.json).slice(0, 160));

  /* Reenvio do documento (reenvio após rejeição) */
  const reenvio = await api('/api/kyc/submit', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      kyc_document_url: `/api/kyc/document/${v1.json.user?.id}/1700000001000-bi_nova.png`,
      kyc_document_type: 'passaporte',
      birth_date: '1998-07-15',
    },
  });
  ok('Reenvio → pending de novo', (reenvio.status === 200 || reenvio.status === 201) && reenvio.json.kyc_status === 'pending', `status=${reenvio.status}`);

  const pubReenviado = await api('/api/products', {
    method: 'POST',
    token: TOKEN_V1,
    ip: IP_V,
    body: {
      name: `Produto F12 reenviado ${RUN}`,
      description: 'Publicação desbloqueada após reenvio do documento.',
      price: 11000,
      type: 'produto_fisico',
    },
  });
  ok('Após reenvio publica → 201', pubReenviado.status === 201, `status=${pubReenviado.status}`);
  if (pubReenviado.json.product?.id) reg.products.push(pubReenviado.json.product.id);

  const aprova = await api('/api/admin/kyc', {
    method: 'POST',
    token: TOKEN_ADMIN,
    ip: IP_A,
    body: { user_id: v1.json.user?.id, action: 'aprovar' },
  });
  ok('Aprovação → 200 + verified', aprova.status === 200 && aprova.json.kyc_status === 'verified' && aprova.json.is_verified_bi === true, `status=${aprova.status}`);

  const loginSelo = await api('/api/auth/login', {
    method: 'POST',
    ip: IP_V,
    body: { email: VENDEDOR.email, password: VENDEDOR.pass },
  });
  ok('Selo azul exposto no login (is_verified_bi=true, verified)', loginSelo.json.user?.is_verified_bi === true && loginSelo.json.user?.kyc_status === 'verified', JSON.stringify(loginSelo.json.user ?? {}).slice(0, 160));

  const fila2 = await api('/api/admin/kyc', { token: TOKEN_ADMIN, ip: IP_A });
  const verificadoNaFila = (fila2.json.verified ?? []).find((p) => p.id === v1.json.user?.id);
  ok('Vendedor aparece na lista de verificados', Boolean(verificadoNaFila));

  /* ── Cleanup ── */
  section('F', 'Cleanup');
  await cleanup();
  console.log('  🧹 Dados de teste removidos.');

  /* ── Resumo ── */
  console.log('\n════════════════════════════════════════');
  console.log(`📊 FASE 12 — ${passed} PASS · ${failed} FAIL · ${skipped} SKIP`);
  if (failed > 0) {
    console.log('Falhas:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('🎉 Fase 12: KYC flexível 100% validado.');
}

async function cleanup() {
  const uids = reg.users.filter(Boolean).join(',');
  const pids = reg.products.filter(Boolean).join(',');
  const exists = new Set(
    (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).map((t) => t.table_name)
  );
  const has = (t) => exists.has(t);
  const steps = [];
  if (uids) steps.push(`DELETE FROM notifications WHERE user_id IN (${uids})`);
  /* Notificações criadas pela submissão KYC para admins reais (fora de uids):
     título + nome único do vendedor de teste. */
  steps.push(`DELETE FROM notifications WHERE title = 'Novo documento KYC para rever' AND body LIKE '%Vendedor F12 ${RUN}%'`);
  if (has('affiliate_earnings') && uids) steps.push(`DELETE FROM affiliate_earnings WHERE affiliate_id IN (SELECT id FROM affiliates WHERE user_id IN (${uids}))`);
  if (has('suspicious_activities') && uids) steps.push(`DELETE FROM suspicious_activities WHERE user_id IN (${uids})`);
  if (has('wallet_transactions') && uids) steps.push(`DELETE FROM wallet_transactions WHERE user_id IN (${uids})`);
  if (has('wallets') && uids) steps.push(`DELETE FROM wallets WHERE user_id IN (${uids})`);
  if (has('push_subscriptions') && uids) steps.push(`DELETE FROM push_subscriptions WHERE user_id IN (${uids})`);
  if (has('store_followers') && uids) steps.push(`DELETE FROM store_followers WHERE user_id IN (${uids}) OR store_id IN (SELECT id FROM stores WHERE owner_id IN (${uids}))`);
  if (has('reviews') && uids) steps.push(`DELETE FROM reviews WHERE user_id IN (${uids}) OR product_id IN (${pids || '0'})`);
  if (has('orders') && uids) steps.push(`DELETE FROM orders WHERE user_id IN (${uids})`);
  if (has('stores') && uids) steps.push(`DELETE FROM stores WHERE owner_id IN (${uids})`);
  if (has('affiliates') && uids) steps.push(`DELETE FROM affiliates WHERE user_id IN (${uids})`);
  if (has('seller_points') && uids) steps.push(`DELETE FROM seller_points WHERE user_id IN (${uids})`);
  if (has('user_badges') && uids) steps.push(`DELETE FROM user_badges WHERE user_id IN (${uids})`);
  if (has('portfolio_items') && uids) steps.push(`DELETE FROM portfolio_items WHERE user_id IN (${uids})`);
  if (has('proposals') && uids) steps.push(`DELETE FROM proposals WHERE client_id IN (${uids}) OR provider_id IN (${uids})`);
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
