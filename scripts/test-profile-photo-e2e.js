/**
 * AngoStart — Teste E2E do fluxo «foto de perfil» (Task: fix profile photo upload).
 *
 * Reproduz o bug reportado e valida a correcção do contrato de formato
 * `<timestamp 13 dígitos>-<nome>` imposto por:
 *   - isInternalMediaUrl()          (POST /api/perfil/avatar)
 *   - MEDIA_PATH_RE                 (GET /api/media/[...path])
 *   - DOC_PATH_RE                   (GET /api/kyc/document/[...path])
 *
 * Requisitos:
 *   - Dev server em http://localhost:3000 (partilha a mesma BD Neon do .env)
 *   - JWT_SECRET no .env local
 *
 * Uso: node scripts/test-profile-photo-e2e.js
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

/* ── .env (leitura directa: o shell pode ter DATABASE_URL sobreposta) ── */
function readEnvKey(key) {
  const line = fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

const DATABASE_URL = readEnvKey('DATABASE_URL');
const JWT_SECRET = readEnvKey('JWT_SECRET');
if (!DATABASE_URL || !JWT_SECRET) {
  console.error('❌ DATABASE_URL/JWT_SECRET em falta no .env');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

/* ── Regexes espelhadas EXACTAMENTE das rotas (fonte da verdade em
      src/lib/payments-manual.ts e src/app/api/media/[...path]/route.ts) ── */
const IS_INTERNAL_MEDIA_URL =
  /^\/api\/media\/(?:produtos|perfil)\/\d+\/\d{13}-[A-Za-z0-9._-]{1,120}$/;
const MEDIA_PATH_RE = /^(?:produtos|perfil)\/\d+\/\d{13}-[A-Za-z0-9._-]{1,120}$/;
const DOC_PATH_RE = /^(\d+)\/(\d{13})-([A-Za-z0-9._-]{1,120})$/;

/* withTimestampPrefix() espelhado de src/lib/upload-client.ts */
function withTimestampPrefix(pathname) {
  const idx = pathname.lastIndexOf('/');
  const dir = idx >= 0 ? pathname.slice(0, idx + 1) : '';
  const name = idx >= 0 ? pathname.slice(idx + 1) : pathname;
  return `${dir}${Date.now()}-${name}`;
}

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* corpo não-JSON (ex.: stream) */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n═══ Teste E2E — foto de perfil (${BASE}) ═══\n`);

  /* ── 0. Unit: contrato de formato ── */
  console.log('── 0. Contrato de formato (regexes das rotas) ──');
  const tsName = withTimestampPrefix('perfil/999/foto.jpg');
  check(
    'pathname novo tem formato <ts>-<nome>',
    /perfil\/999\/\d{13}-foto\.jpg$/.test(tsName),
    tsName
  );
  check(
    'URL novo PASSA em isInternalMediaUrl',
    IS_INTERNAL_MEDIA_URL.test(`/api/media/${tsName}`)
  );
  check(
    'path novo PASSA em MEDIA_PATH_RE (rota media)',
    MEDIA_PATH_RE.test(tsName)
  );
  const kycTail = withTimestampPrefix('999/documento.jpg');
  check('path KYC novo PASSA em DOC_PATH_RE', DOC_PATH_RE.test(kycTail));

  const oldName = 'perfil/999/foto.jpg'; // formato antigo SEM timestamp (bug)
  check(
    'URL antigo (sem ts) FALHA em isInternalMediaUrl — causa raiz do 400',
    !IS_INTERNAL_MEDIA_URL.test(`/api/media/${oldName}`)
  );
  check(
    'path antigo FALHA em MEDIA_PATH_RE — a foto nunca apareceria',
    !MEDIA_PATH_RE.test(oldName)
  );
  check(
    'traversal rejeitado por isInternalMediaUrl',
    !IS_INTERNAL_MEDIA_URL.test('/api/media/perfil/999/..') &&
      !IS_INTERNAL_MEDIA_URL.test('/api/media/perfil/999/1234567890123-../../x.jpg')
  );
  check(
    'URL externo rejeitado por isInternalMediaUrl',
    !IS_INTERNAL_MEDIA_URL.test('https://malicioso.com/foto.jpg')
  );
  const longName = `${'a'.repeat(80)}.jpg`; // safeFileName limita a 80 chars
  check(
    'nome máx (80 chars + ts + sufixo aleatório) passa no limite de 120',
    IS_INTERNAL_MEDIA_URL.test(
      `/api/media/perfil/999/${Date.now()}-${longName}-abc123xyz`
    )
  );

  /* ── 1. Utilizador de teste (temporário) ── */
  console.log('\n── 1. Preparação: utilizador temporário ──');
  const email = `qa-upload-${Date.now()}@angostart.test`;
  const created = await sql`
    INSERT INTO users (name, email, role, blocked)
    VALUES ('QA Upload Temp', ${email}, 'cliente', FALSE)
    RETURNING id, email, role
  `;
  const user = created[0];
  const token = jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(`  ✅ Utilizador ${user.id} criado (${email})`);

  try {
    /* ── 2. Reprodução do bug ── */
    console.log('\n── 2. Reprodução do bug (formato antigo, sem timestamp) ──');
    const bug = await api('POST', '/api/perfil/avatar', {
      token,
      body: { profile_image: `/api/media/${oldName}` },
    });
    check(
      'POST avatar com URL antigo → 400 (bug original)',
      bug.status === 400,
      `recebido ${bug.status}`
    );
    check(
      'mensagem de erro = a reportada pelo utilizador',
      bug.json?.error ===
        'A foto de perfil deve ser enviada pelo upload da AngoStart (escolhe um ficheiro).',
      bug.json?.error
    );

    /* ── 3. Correcção ── */
    console.log('\n── 3. Correcção (formato novo com timestamp) ──');
    const newPath = withTimestampPrefix(`perfil/${user.id}/minha_foto_2024.jpg`);
    const newUrl = `/api/media/${newPath}`;
    const save = await api('POST', '/api/perfil/avatar', {
      token,
      body: { profile_image: newUrl },
    });
    check(
      'POST avatar com URL novo → 200 ok',
      save.status === 200 && save.json?.ok === true,
      `recebido ${save.status} ${JSON.stringify(save.json)}`
    );
    check('profile_image ecoada na resposta', save.json?.profile_image === newUrl);

    const me = await api('GET', '/api/perfil/avatar', { token });
    check(
      'GET avatar devolve o URL gravado',
      me.status === 200 && me.json?.profile_image === newUrl,
      JSON.stringify(me.json)
    );

    /* ── 4. Rota de media: regex vs blob-token ── */
    console.log('\n── 4. GET /api/media — formato aceite (regex) ──');
    const mediaNew = await api('GET', `/api/media/${newPath}`);
    // 503 = passou a regex e chegou à verificação do BLOB token (ausente
    // localmente). 404 = regex rejeitou o path (formato errado).
    check(
      'GET media (formato novo) NÃO é 404 — regex aceite',
      mediaNew.status !== 404,
      `recebido ${mediaNew.status}`
    );
    const mediaOld = await api('GET', `/api/media/${oldName}`);
    check(
      'GET media (formato antigo) → 404 — nunca apareceria',
      mediaOld.status === 404,
      `recebido ${mediaOld.status}`
    );

    /* ── 5. Segurança do dono ── */
    console.log('\n── 5. Segurança: namespace de outro utilizador ──');
    const other = await api('POST', '/api/perfil/avatar', {
      token,
      body: {
        profile_image: `/api/media/${withTimestampPrefix('perfil/424242/foto.jpg')}`,
      },
    });
    check(
      'URL de outro utilizador → 403',
      other.status === 403,
      `recebido ${other.status}`
    );

    /* ── 6. Rota de emissão de token (sem BLOB token local) ── */
    console.log('\n── 6. POST /api/upload/image — emissão de token ──');
    const tokReq = await api('POST', '/api/upload/image', {
      token,
      body: {
        type: 'blob.generate-client-token',
        payload: {
          pathname: withTimestampPrefix(`perfil/${user.id}/foto.jpg`),
          clientPayload: '{}',
        },
      },
    });
    // Localmente sem BLOB_READ_WRITE_TOKEN → 503 com mensagem clara.
    // 400 aqui significaria namespace/formato rejeitado (erro nosso).
    check(
      'token request chega à verificação do Blob (503 local, não 400)',
      tokReq.status === 503 &&
        /BLOB_READ_WRITE_TOKEN/.test(tokReq.json?.error || ''),
      `recebido ${tokReq.status} ${JSON.stringify(tokReq.json)}`
    );
    const tokBad = await api('POST', '/api/upload/image', {
      token,
      body: {
        type: 'blob.generate-client-token',
        payload: { pathname: `produtos/${user.id}/foto.jpg`, clientPayload: '{}' },
      },
    });
    check(
      'cliente não pode escrever em produtos/ → 400',
      tokBad.status === 400,
      `recebido ${tokBad.status}`
    );

    /* ── 7. Sem sessão ── */
    console.log('\n── 7. Guard de autenticação ──');
    const anon = await api('POST', '/api/perfil/avatar', {
      body: { profile_image: newUrl },
    });
    check('POST avatar sem token → 401', anon.status === 401);
  } finally {
    /* ── Cleanup ── */
    await sql`DELETE FROM users WHERE id = ${user.id}`;
    console.log(`\n🧹 Utilizador temporário ${user.id} removido.`);
  }

  console.log(`\n═══ Resultado: ${passed} passaram, ${failed} falharam ═══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e.message);
  process.exit(1);
});
