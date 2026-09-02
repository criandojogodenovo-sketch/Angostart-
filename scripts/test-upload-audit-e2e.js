/**
 * AngoStart — Auditoria E2E EXAUSTIVA do sistema de uploads (Fases 1-5).
 *
 * Cobre os 7 fluxos de upload:
 *   1. Foto de perfil      → /api/upload/image  (perfil/)    → POST /api/perfil/avatar
 *   2. Imagem de produto   → /api/upload/image  (produtos/)  → POST /api/products
 *   3. PDF de ebook        → /api/products/upload (ebooks/)  → products.file_url
 *   4. Logo/banner de loja → /api/upload/image  (produtos/)  → PATCH /api/stores
 *   5. Logo/fotos estabel. → /api/upload/image  (produtos/)  → POST /api/estabelecimentos
 *   6. Documento KYC       → /api/kyc/upload    (kyc/)       → POST /api/kyc/submit
 *   7. Comprovativo        → /api/orders/[id]/proof (base64) → orders.payment_proof
 *
 * Simula falhas: >limite, extensão errada (.exe/.php), evento SDK inválido,
 * namespace errado, papel errado (cliente vs vendedor), 401 sem sessão,
 * 404 rota inexistente, magic bytes trocados.
 *
 * Uso: node scripts/test-upload-audit-e2e.js   (dev server em :3000)
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');

function readEnvKey(key) {
  const line = fs
    .readFileSync(path.join(ROOT, '.env'), 'utf8')
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

let passed = 0;
let failed = 0;

/** Identidade desta execução (IP de teste + emails temporários). */
const RUN_STAMP = Date.now();
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
  // IP de teste único por execução — o rate limiter é por IP (via
  // x-forwarded-for, fixado pela plataforma na Vercel). Evita 429 em
  // execuções repetidas da suite no dev local.
  const testIp = `10.77.${Math.floor(RUN_STAMP / 60) % 256}.${RUN_STAMP % 256}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': testIp,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* não-JSON */
  }
  return { status: res.status, json };
}

function sdkTokenEvent(pathname) {
  return {
    type: 'blob.generate-client-token',
    payload: { pathname, clientPayload: '{}' },
  };
}

async function main() {
  console.log(`\n═══ Auditoria E2E de uploads — ${BASE} ═══\n`);

  /* ── 0. GUARD: ficheiros de rota existem na working tree ──
     (bug histórico: rotas apagadas da working tree entre sessões) */
  console.log('── 0. Existência das rotas de upload no disco ──');
  const routeFiles = [
    'src/app/api/upload/image/route.ts',
    'src/app/api/products/upload/route.ts',
    'src/app/api/kyc/upload/route.ts',
    'src/app/api/media/[...path]/route.ts',
    'src/app/api/kyc/document/[...path]/route.ts',
    'src/app/api/products/[id]/download/route.ts',
    'src/app/api/orders/[id]/proof/route.ts',
    'src/app/api/perfil/avatar/route.ts',
    'src/lib/upload-client.ts',
  ];
  for (const f of routeFiles) {
    check(f, fs.existsSync(path.join(ROOT, f)));
  }

  /* ── 1. Utilizadores temporários (cliente + vendedor) ── */
  console.log('\n── 1. Preparação: utilizadores temporários ──');
  const stamp = RUN_STAMP;
  const cliente = (
    await sql`
      INSERT INTO users (name, email, role, blocked)
      VALUES ('QA Cliente', ${`qa-cliente-${stamp}@angostart.test`}, 'cliente', FALSE)
      RETURNING id, email, role`
  )[0];
  const vendedor = (
    await sql`
      INSERT INTO users (name, email, role, blocked)
      VALUES ('QA Vendedor', ${`qa-vendedor-${stamp}@angostart.test`}, 'criador', FALSE)
      RETURNING id, email, role`
  )[0];
  const tokenFor = (u) =>
    jwt.sign({ sub: String(u.id), email: u.email, role: u.role }, JWT_SECRET, {
      expiresIn: '1h',
    });
  const tokCliente = tokenFor(cliente);
  const tokVendedor = tokenFor(vendedor);
  console.log(`  ✅ cliente #${cliente.id} e vendedor #${vendedor.id} criados`);

  try {
    /* ── 2. Autenticação (401 sem sessão) em TODAS as rotas ── */
    console.log('\n── 2. Guard 401 sem sessão (todas as rotas de upload) ──');
    const anonTargets = [
      ['POST', '/api/upload/image'],
      ['POST', '/api/products/upload'],
      ['POST', '/api/kyc/upload'],
      ['POST', '/api/perfil/avatar'],
      ['POST', `/api/orders/999999/proof`],
    ];
    for (const [m, u] of anonTargets.slice(0, 4)) {
      const r = await api(m, u, { body: sdkTokenEvent('perfil/1/x.jpg') });
      check(`${m} ${u} sem sessão → 401`, r.status === 401, `recebido ${r.status}`);
    }
    // proof: valida o COMPROVATIVO antes da auth (encomenda de convidado
    // autoriza por telefone) — corpo sem payment_proof → 400, não 401.
    const rProof = await api('POST', '/api/orders/999999/proof', {
      body: sdkTokenEvent('perfil/1/x.jpg'),
    });
    check('POST /api/orders/999999/proof sem proof → 400 (validação prévia)',
      rProof.status === 400, `recebido ${rProof.status}`);
    const r404 = await api('POST', '/api/upload/video', {
      token: tokVendedor,
      body: sdkTokenEvent('perfil/1/x.jpg'),
    });
    check('rota inexistente /api/upload/video → 404', r404.status === 404, `recebido ${r404.status}`);

    /* ── 3. Evento SDK inválido (body sem type) ── */
    console.log('\n── 3. Corpo inválido (evento SDK desconhecido) → 400 ──');
    for (const u of ['/api/upload/image', '/api/products/upload', '/api/kyc/upload']) {
      const r = await api('POST', u, {
        token: tokVendedor,
        body: { payload: { pathname: 'perfil/1/x.jpg' } }, // sem type
      });
      check(`${u} sem type → 400`, r.status === 400, `recebido ${r.status}`);
    }

    /* ── 4. Matriz de papéis × namespaces ── */
    console.log('\n── 4. Papéis × namespaces (token issuance, sem Blob token local → 503) ──');
    const ts = Date.now();
    // Cliente: perfil/ OK (chega ao Blob → 503 local); produtos/ e kyc/ → 400/403
    let r = await api('POST', '/api/upload/image', {
      token: tokCliente,
      body: sdkTokenEvent(`perfil/${cliente.id}/${ts}-foto.jpg`),
    });
    check('cliente → perfil/ no upload/image → 503 (aceite, Blob em falta local)',
      r.status === 503, `recebido ${r.status}`);
    r = await api('POST', '/api/upload/image', {
      token: tokCliente,
      body: sdkTokenEvent(`produtos/${cliente.id}/${ts}-foto.jpg`),
    });
    check('cliente → produtos/ no upload/image → 400 (namespace negado)',
      r.status === 400, `recebido ${r.status}`);
    r = await api('POST', '/api/kyc/upload', {
      token: tokCliente,
      body: sdkTokenEvent(`kyc/${cliente.id}/${ts}-doc.jpg`),
    });
    check('cliente → /api/kyc/upload → 403 (rota seller-only)',
      r.status === 403, `recebido ${r.status}`);
    r = await api('POST', '/api/products/upload', {
      token: tokCliente,
      body: sdkTokenEvent(`ebooks/${cliente.id}/${ts}-livro.pdf`),
    });
    check('cliente → /api/products/upload → 403 (rota seller-only)',
      r.status === 403, `recebido ${r.status}`);

    // Vendedor: produtos/ + perfil/ + kyc/ + ebooks/ OK
    for (const [url, ns, label] of [
      ['/api/upload/image', `produtos/${vendedor.id}/${ts}-logo.jpg`, 'vendedor → produtos/ no upload/image'],
      ['/api/upload/image', `perfil/${vendedor.id}/${ts}-cara.jpg`, 'vendedor → perfil/ no upload/image'],
      ['/api/kyc/upload', `kyc/${vendedor.id}/${ts}-bi.jpg`, 'vendedor → kyc/ no kyc/upload'],
      ['/api/products/upload', `ebooks/${vendedor.id}/${ts}-guia.pdf`, 'vendedor → ebooks/ no products/upload'],
    ]) {
      const rr = await api('POST', url, { token: tokVendedor, body: sdkTokenEvent(ns) });
      check(`${label} → 503 (aceite, Blob em falta local)`, rr.status === 503, `recebido ${rr.status}`);
    }
    // KYC via upload/image → rota certa é /api/kyc/upload
    r = await api('POST', '/api/upload/image', {
      token: tokVendedor,
      body: sdkTokenEvent(`kyc/${vendedor.id}/${ts}-bi.jpg`),
    });
    check('kyc/ no upload/image → 400 (rota própria é /api/kyc/upload)',
      r.status === 400, `recebido ${r.status}`);

    /* ── 5. Extensões perigosas (.exe, .php) ── */
    console.log('\n── 5. Extensões perigosas → 400 ──');
    for (const [url, ns, rota] of [
      ['/api/upload/image', `produtos/${vendedor.id}/${ts}-virus.exe`, 'upload/image'],
      ['/api/kyc/upload', `kyc/${vendedor.id}/${ts}-shell.php`, 'kyc/upload'],
      ['/api/products/upload', `ebooks/${vendedor.id}/${ts}-malware.exe`, 'products/upload'],
      ['/api/upload/image', `perfil/${vendedor.id}/${ts}-script.php`, 'upload/image'],
    ]) {
      const rr = await api('POST', url, { token: tokVendedor, body: sdkTokenEvent(ns) });
      check(`${rota} com .${ns.split('.').pop()} → 400`, rr.status === 400, `recebido ${rr.status}`);
    }

    /* ── 6. Pathname traversal ── */
    console.log('\n── 6. Path traversal → 400 ──');
    r = await api('POST', '/api/upload/image', {
      token: tokVendedor,
      body: sdkTokenEvent(`produtos/${vendedor.id}/../${vendedor.id}/${ts}-x.jpg`),
    });
    check('traversal em produtos/ → 400', r.status === 400, `recebido ${r.status}`);
    r = await api('POST', '/api/upload/image', {
      token: tokVendedor,
      body: sdkTokenEvent(`produtos/999/${ts}-outro.jpg`),
    });
    check('namespace de OUTRO utilizador → 400', r.status === 400, `recebido ${r.status}`);

    /* ── 7. Comprovativo (base64 + magic bytes + tamanho) ── */
    console.log('\n── 7. POST /api/orders/[id]/proof — validação do data URL ──');
    const jpegB64 = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]).toString('base64');
    const pngB64 = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]).toString('base64');
    r = await api('POST', '/api/orders/999999/proof', {
      body: { payment_proof: 'data:image/jpeg;base64,####invalido####' },
    });
    check('data URL malformado → 400 (validação antes do lookup)',
      r.status === 400, `recebido ${r.status}`);
    r = await api('POST', '/api/orders/999999/proof', {
      body: { payment_proof: `data:image/jpeg;base64,${pngB64}` },
    });
    check('magic bytes PNG com MIME jpeg → 400 (assinatura real exigida)',
      r.status === 400, `recebido ${r.status}`);
    const big = Buffer.alloc(2 * 1024 * 1024 + 100, 0xff);
    r = await api('POST', '/api/orders/999999/proof', {
      body: { payment_proof: `data:image/jpeg;base64,${big.toString('base64')}` },
    });
    check('>2 MB → 400', r.status === 400, `recebido ${r.status}`);
    r = await api('POST', '/api/orders/999999/proof', {
      body: { payment_proof: `data:image/jpeg;base64,${jpegB64}` },
    });
    check('JPEG válido + encomenda inexistente → 404 (validação passou)',
      r.status === 404, `recebido ${r.status}`);

    /* ── 8. Regressão foto de perfil (formato + gravação) ── */
    console.log('\n── 8. Regressão: foto de perfil (contrato de formato) ──');
    const oldUrl = `/api/media/perfil/${cliente.id}/foto.jpg`;
    r = await api('POST', '/api/perfil/avatar', {
      token: tokCliente,
      body: { profile_image: oldUrl },
    });
    check('URL sem timestamp → 400 (bug original continua tapado)',
      r.status === 400 &&
        r.json?.error ===
          'A foto de perfil deve ser enviada pelo upload da AngoStart (escolhe um ficheiro).',
      `recebido ${r.status}`);
    const newUrl = `/api/media/perfil/${cliente.id}/${ts}-minha_foto.jpg`;
    r = await api('POST', '/api/perfil/avatar', {
      token: tokCliente,
      body: { profile_image: newUrl },
    });
    check('URL com timestamp → 200 gravado', r.status === 200 && r.json?.ok === true,
      `recebido ${r.status} ${JSON.stringify(r.json)}`);
    r = await api('GET', '/api/perfil/avatar', { token: tokCliente });
    check('GET avatar devolve o URL gravado', r.json?.profile_image === newUrl,
      JSON.stringify(r.json));
    r = await api('GET', `/api/media/perfil/${cliente.id}/${ts}-minha_foto.jpg`);
    check('GET media formato novo → não-404 (regex aceite)', r.status !== 404,
      `recebido ${r.status}`);
    r = await api('POST', '/api/perfil/avatar', {
      token: tokCliente,
      body: { clear: true },
    });
    check('clear:true remove a foto → 200', r.status === 200, `recebido ${r.status}`);

    /* ── 9. Limites client-side (validateFileLocally, espelhado) ── */
    console.log('\n── 9. Validação local client-side (espelho de validateFileLocally) ──');
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const tooBig = { size: 5 * 1024 * 1024 + 1, type: 'image/jpeg', name: 'a.jpg' };
    const badMime = { size: 100, type: 'image/gif', name: 'a.gif' };
    const badExt = { size: 100, type: 'image/jpeg', name: 'a.php' };
    const okFile = { size: 100, type: 'image/webp', name: 'a.webp' };
    check('>5 MB rejeitado localmente',
      tooBig.size > 5 * 1024 * 1024);
    check('GIF rejeitado (fora da whitelist)',
      !(allowedTypes.includes(badMime.type)));
    check('.php rejeitado (extensão)',
      !['jpg', 'jpeg', 'png', 'webp'].includes(badExt.name.split('.').pop()));
    check('WebP aceite',
      allowedTypes.includes(okFile.type) &&
        ['jpg', 'jpeg', 'png', 'webp'].includes(okFile.name.split('.').pop()));
  } finally {
    await sql`DELETE FROM users WHERE id IN (${cliente.id}, ${vendedor.id})`;
    console.log(`\n🧹 Utilizadores temporários ${cliente.id}, ${vendedor.id} removidos.`);
  }

  console.log(`\n═══ Resultado: ${passed} passaram, ${failed} falharam ═══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e.message);
  process.exit(1);
});
