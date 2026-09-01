/**
 * AngoStart — Teste de regressão do UPLOAD (fix do erro 400).
 *
 * Contexto: /api/upload/image devolvia 400 para TODOS os uploads legítimos.
 * Causas: (1) rotas apagadas da working tree; (2) pré-validação multipart
 * incompatível com o SDK (@vercel/blob/client envia JSON, não form-data);
 * (3) handleUpload recebia request.body (stream) em vez do evento parsed.
 *
 * O que valida:
 *   - Fluxo EXATO do SDK: POST JSON { type: 'blob.generate-client-token',
 *     payload: { pathname } } com um ficheiro pequeno real (PNG 1x1).
 *   - Localmente (sem BLOB_READ_WRITE_TOKEN) a rota deve responder 503
 *     (armazenamento não configurado) — NUNCA 400 — para pedidos válidos.
 *   - Casos negativos: 401 sem sessão; 400 para multipart, namespace
 *     alheio, extensão proibida e path traversal.
 *   - Rotas /api/products/upload (PDF) e /api/kyc/upload também tratam o
 *     evento SDK corretamente (503 local, nunca 400 para pedidos válidos).
 *
 * Uso:
 *   1) Arrancar servidor standalone na porta 3000 com DATABASE_URL do Neon
 *   2) node scripts/test-upload-fix.js
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

try {
  require('fs')
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/);
      // .env tem prioridade sobre a env herdada quando esta não é Postgres
      // (sandboxes exportam DATABASE_URL=file:... que sombreia o ficheiro)
      const deveSobrepor =
        m && (['DATABASE_URL', 'NEON_DATABASE_URL'].includes(m[1]) ? !process.env[m[1]]?.startsWith('postgres') : !process.env[m[1]]);
      if (m && deveSobrepor) process.env[m[1]] = m[2];
    });
} catch {}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL em falta.');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const TS = Date.now().toString(36);
const PWD = 'Upload!Test2026';
const USERS = {
  vendedor: { email: `upfix-${TS}-vend@test.local`, role: 'criador', name: `UploadFix Vend ${TS}` },
  cliente: { email: `upfix-${TS}-cli@test.local`, role: 'cliente', name: `UploadFix Cli ${TS}` },
};
const tokens = {};
const userIds = {};

let pass = 0;
let fail = 0;
const failures = [];

function check(id, name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${id} ${name}`);
  } else {
    fail++;
    failures.push(`${id} ${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ❌ ${id} ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** PNG 1x1 válido (82 bytes) — o "ficheiro pequeno" do teste. */
function pngPequeno() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000d4944415478da63fcffff3f030005fe02fea72d1e480000000049454e44ae426082',
    'hex'
  );
}

/** Evento JSON exato que o SDK @vercel/blob/client envia à rota. */
const sdkEvent = (pathname) => ({
  type: 'blob.generate-client-token',
  payload: { pathname, clientPayload: null, multipart: false },
});

async function post(path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method: 'POST', headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main() {
  console.log('🧪 AngoStart — Teste de regressão do upload (fix 400)\n');

  /* ── SETUP ── */
  console.log('⚙️  Setup: utilizadores de teste');
  const hash = await bcrypt.hash(PWD, 10);
  for (const [k, u] of Object.entries(USERS)) {
    await sql`INSERT INTO users (name, email, password_hash, role) VALUES (${u.name}, ${u.email}, ${hash}, ${u.role})`;
    const r = await post('/api/auth/login', { body: { email: u.email, password: PWD } });
    if (r.status === 200 && r.json?.token) tokens[k] = r.json.token;
    else console.log(`  ⚠️  login ${k} falhou (${r.status})`);
  }
  check('S1', 'login vendedor + cliente', Object.keys(tokens).length === 2);

  for (const [k, u] of Object.entries(USERS)) {
    const rows = await sql`SELECT id FROM users WHERE email = ${u.email}`;
    userIds[k] = rows[0]?.id;
  }
  check('S2', 'IDs dos utilizadores obtidos', Number.isInteger(userIds.vendedor) && Number.isInteger(userIds.cliente));

  const ficheiro = pngPequeno();
  check('S3', 'ficheiro pequeno de teste (PNG 1x1, < 1 KB)', ficheiro.length < 1024 && ficheiro[0] === 0x89, `${ficheiro.length} bytes`);

  /* ── FLUXO LEGÍTIMO (o que falhava com 400) ── */
  console.log('\n📦 A. Fluxo legítimo do SDK (ficheiro pequeno real)');
  const rVend = await post('/api/upload/image', {
    token: tokens.vendedor,
    body: sdkEvent(`produtos/${userIds.vendedor}/produto-${TS}.png`),
  });
  check(
    'A1',
    'vendedor · produtos/<id>/x.png → 503 local (ANTES devolvia 400!)',
    rVend.status === 503 || rVend.status === 200,
    `got ${rVend.status} ${JSON.stringify(rVend.json)}`
  );
  if (rVend.status === 200) {
    check('A1b', 'token Blob emitido (clientToken presente)', Boolean(rVend.json?.clientToken));
  }
  const rCli = await post('/api/upload/image', {
    token: tokens.cliente,
    body: sdkEvent(`perfil/${userIds.cliente}/avatar-${TS}.png`),
  });
  check(
    'A2',
    'cliente · perfil/<id>/avatar.png → 503 local (ANTES devolvia 400!)',
    rCli.status === 503 || rCli.status === 200,
    `got ${rCli.status} ${JSON.stringify(rCli.json)}`
  );

  /* ── OUTRAS ROTAS DE UPLOAD (mesma correção) ── */
  console.log('\n📄 B. Rotas PDF e KYC (mesma correção do body)');
  const rPdf = await post('/api/products/upload', {
    token: tokens.vendedor,
    body: sdkEvent(`ebooks/${userIds.vendedor}/ebook-${TS}.pdf`),
  });
  check('B1', 'products/upload · ebooks/<id>/x.pdf → 503 local (nunca 400)', rPdf.status === 503 || rPdf.status === 200, `got ${rPdf.status} ${JSON.stringify(rPdf.json)}`);
  const rKyc = await post('/api/kyc/upload', {
    token: tokens.vendedor,
    body: sdkEvent(`kyc/${userIds.vendedor}/bi-${TS}.jpg`),
  });
  check('B2', 'kyc/upload · kyc/<id>/x.jpg → 503 local (nunca 400)', rKyc.status === 503 || rKyc.status === 200, `got ${rKyc.status} ${JSON.stringify(rKyc.json)}`);

  /* ── CASOS NEGATIVOS ── */
  console.log('\n🛡️  C. Casos negativos');
  const c1 = await post('/api/upload/image', { body: sdkEvent(`produtos/${userIds.vendedor}/x.png`) });
  check('C1', 'sem sessão → 401', c1.status === 401, `got ${c1.status}`);

  const form = new FormData();
  form.append('file', new Blob([ficheiro], { type: 'image/png' }), 'x.png');
  const c2 = await post('/api/upload/image', { token: tokens.vendedor, raw: form });
  check('C2', 'corpo multipart (não-SDK) → 400', c2.status === 400, `got ${c2.status}`);

  const c3 = await post('/api/upload/image', { token: tokens.vendedor, body: sdkEvent(`produtos/999999/x-${TS}.png`) });
  check('C3', 'namespace alheio → 400', c3.status === 400, `got ${c3.status}`);

  const c4 = await post('/api/upload/image', { token: tokens.vendedor, body: sdkEvent(`produtos/${userIds.vendedor}/shell-${TS}.php`) });
  check('C4', 'extensão .php → 400', c4.status === 400, `got ${c4.status}`);
  const c5 = await post('/api/upload/image', { token: tokens.vendedor, body: sdkEvent(`produtos/${userIds.vendedor}/exe-${TS}.exe`) });
  check('C5', 'extensão .exe → 400', c5.status === 400, `got ${c5.status}`);
  const c6 = await post('/api/upload/image', { token: tokens.vendedor, body: sdkEvent(`produtos/${userIds.vendedor}/../${TS}-ebooks/x.png`) });
  check('C6', 'path traversal ../ → 400', c6.status === 400, `got ${c6.status}`);
  const c7 = await post('/api/upload/image', { token: tokens.vendedor, raw: 'isto não é json' });
  check('C7', 'corpo não-JSON → 400', c7.status === 400, `got ${c7.status}`);
  const c8 = await post('/api/upload/image', { token: tokens.vendedor, body: { type: 'tipo.desconhecido', payload: {} } });
  check('C8', 'tipo de evento desconhecido → 400', c8.status === 400, `got ${c8.status}`);
  const c9 = await post('/api/upload/image', { token: tokens.cliente, body: sdkEvent(`produtos/${userIds.cliente}/x-${TS}.png`) });
  check('C9', 'cliente a escrever em produtos/ → 400', c9.status === 400, `got ${c9.status}`);

  /* ── CLEANUP ── */
  console.log('\n🧹 Cleanup');
  for (const u of Object.values(USERS)) {
    await sql`DELETE FROM users WHERE email = ${u.email}`;
  }
  console.log('  ✓ utilizadores de teste removidos do Neon');

  /* ── RELATÓRIO ── */
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Resultado: ${pass} passaram, ${fail} falharam`);
  if (failures.length) {
    console.log('\nFalhas:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('═'.repeat(60));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e);
  process.exit(1);
});
