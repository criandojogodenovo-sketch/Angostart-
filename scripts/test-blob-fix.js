/**
 * AngoStart — Testes do FIX Blob privado (upload/download de PDFs)
 *
 * Valida:
 *  1. Upload route: access:'private' no código; 401 sem sessão; 403 não-vendedor.
 *  2. Download route: matriz de autorização (401/403/404), ordem correta
 *     (autorização ANTES do acesso ao blob), presign+fallback presentes,
 *     NENHUMA resposta expõe o URL do Blob ('blob.vercel-storage.com').
 *  3. Fluxo de compra: comprador com order 'pago' passa a matriz de
 *     autorização (com token fake → falha no blob com 502/503 sem leak;
 *     em produção com token real → 307 para URL temporário de 1h).
 *
 * Pré-requisitos:
 *  - Servidor de produção a correr: PORT=3456 BLOB_READ_WRITE_TOKEN=vercel_blob_rw_FAKE \
 *      node --env-file=.env node_modules/next/dist/bin/next start -p 3456
 *  - node --env-file=.env scripts/test-blob-fix.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

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

async function api(method, urlPath, { token, body, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual', // queremos ver o 307, não segui-lo
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* não-JSON (redirect HTML, stream, …) */
  }
  return { status: res.status, headers: res.headers, text, json, location: res.headers.get('location') };
}

async function registerAndLogin(email, name, endpoint) {
  const body = { name, email, password: `Teste${SUFFIX}!`, telefone: '+244900000000' };
  if (endpoint === 'vendedor') {
    body.role = 'criador'; // criador | prestador_domicilio | prestador_remoto
    body.bio = 'Vendedor de teste E2E da AngoStart.'; // obrigatória (≥10 chars)
  }
  const reg = await api('POST', `/api/auth/register/${endpoint}`, { body });
  // 201 criado; 409 já existe (corrida anterior)
  const login = await api('POST', '/api/auth/login', {
    body: { email, password: `Teste${SUFFIX}!` },
  });
  if (!login.json?.token) {
    throw new Error(`Login falhou para ${email}: reg=${reg.status} login=${login.status} ${login.text.slice(0, 200)}`);
  }
  return { token: login.json.token, user: login.json.user };
}

function checkSourceLeaks() {
  const uploadSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'api', 'products', 'upload', 'route.ts'),
    'utf8'
  );
  const downloadSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'api', 'products', '[id]', 'download', 'route.ts'),
    'utf8'
  );
  ok('upload: put() usa access: private', /access:\s*'private'/.test(uploadSrc));
  ok('upload: sem access: public', !/access:\s*'public'/.test(uploadSrc));
  ok('download: gera URL temporário (issueSignedToken + presignUrl)', /issueSignedToken/.test(downloadSrc) && /presignUrl/.test(downloadSrc));
  ok('download: presign scoped ao pathname + operations get', /operations:\s*\['get'\]/.test(downloadSrc));
  ok('download: expiração de 3600s', /TEMP_URL_TTL_SECONDS\s*=\s*3600/.test(downloadSrc));
  ok('download: fallback stream privado get(...access: private)', /get\(product\.file_url,\s*\{\s*access:\s*'private'/.test(downloadSrc));
  ok('download: resposta NUNCA devolve file_url/json com URL do blob', !/file_url:\s*product/.test(downloadSrc));
  return { uploadSrc, downloadSrc };
}

async function main() {
  console.log('━━━ FIX Blob privado — testes E2E ━━━\n');
  const sql = neon(dbUrl());
  const src = checkSourceLeaks();

  /* ── 0. Servidor acessível ── */
  const health = await api('GET', '/api/products?limit=1');
  ok('Servidor acessível em ' + BASE, health.status === 200, `status=${health.status}`);

  /* ── 1. Utilizadores de teste ── */
  const sellerEmail = `blobfix-seller-${SUFFIX}@e2e.angostart`;
  const buyerEmail = `blobfix-buyer-${SUFFIX}@e2e.angostart`;
  const strangerEmail = `blobfix-stranger-${SUFFIX}@e2e.angostart`;

  const seller = await registerAndLogin(sellerEmail, 'Vendedor BlobFix', 'vendedor');
  const buyer = await registerAndLogin(buyerEmail, 'Comprador BlobFix', 'cliente');
  const stranger = await registerAndLogin(strangerEmail, 'Estranho BlobFix', 'cliente');
  ok('3 utilizadores de teste criados e autenticados', !!seller.token && !!buyer.token && !!stranger.token);

  /* ── 2. Fixtures na BD ── */
  const fileUrl = `https://e2efakestore${SUFFIX}.blob.vercel-storage.com/ebooks/${seller.user.id}/1700000000-e2e-teste.pdf`;
  const ins = await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock, file_url)
    VALUES ('E2E BlobFix PDF', 'Produto de teste do fix Blob', 1000, 'infoproduto',
            'graduation-cap', 'from-emerald-400 to-emerald-600', '', ${seller.user.id}, FALSE, 4.5, -1, ${fileUrl})
    RETURNING id
  `;
  const productId = Number(ins[0].id);

  const insNoFile = await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock, file_url)
    VALUES ('E2E BlobFix SemFicheiro', 'Sem PDF', 1000, 'infoproduto',
            'graduation-cap', 'from-emerald-400 to-emerald-600', '', ${seller.user.id}, FALSE, 4.5, -1, NULL)
    RETURNING id
  `;
  const productIdNoFile = Number(insNoFile[0].id);

  await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, notes, user_id, payment_method)
    VALUES ('Comprador BlobFix', '+244900000000', ${buyerEmail},
            ${JSON.stringify([{ id: productId, name: 'E2E BlobFix PDF', price_kz: 1000, quantity: 1 }])}::jsonb,
            1000, 'pago', 'retirada', 'teste E2E', ${buyer.user.id}, 'kwik')
  `;
  const paidOrders = await sql`
    SELECT 1 FROM orders WHERE user_id = ${buyer.user.id} AND status = 'pago'
      AND items @> ${JSON.stringify([{ id: productId }])}::jsonb LIMIT 1
  `;
  ok('Encomenda paga criada para o comprador', paidOrders.length === 1);

  try {
    /* ── 3. Matriz de autorização do download ── */
    console.log('\n━━━ Matriz de autorização (download) ━━━');

    const anon = await api('GET', `/api/products/${productId}/download`);
    ok('Sem sessão → 401', anon.status === 401, `status=${anon.status}`);

    const strangerRes = await api('GET', `/api/products/${productId}/download`, { token: stranger.token });
    ok('Utilizador SEM compra → 403', strangerRes.status === 403, `status=${strangerRes.status}`);

    const noFile = await api('GET', `/api/products/${productIdNoFile}/download`, { token: buyer.token });
    ok('Produto sem ficheiro → 404', noFile.status === 404, `status=${noFile.status}`);

    /* ── 4. Autorizados: falha limpa com token FAKE (em produção → 307) ── */
    console.log('\n━━━ Autorizados (token Blob fake local) ━━━');

    const buyerRes = await api('GET', `/api/products/${productId}/download`, { token: buyer.token });
    ok(
      'Comprador pago passa a autorização (blob indisponível local → 502/503)',
      buyerRes.status === 502 || buyerRes.status === 503,
      `status=${buyerRes.status}`
    );

    const sellerRes = await api('GET', `/api/products/${productId}/download`, { token: seller.token });
    ok(
      'Dono/vendedor passa a autorização (blob indisponível local → 502/503)',
      sellerRes.status === 502 || sellerRes.status === 503,
      `status=${sellerRes.status}`
    );

    const streamMode = await api('GET', `/api/products/${productId}/download?mode=stream`, { token: buyer.token });
    ok(
      'mode=stream também passa a autorização (mesma falha limpa)',
      streamMode.status === 502 || streamMode.status === 503,
      `status=${streamMode.status}`
    );

    /* ── 5. Nenhum leak do URL do Blob em nenhuma resposta ── */
    console.log('\n━━━ Segurança: sem leak de URLs ━━━');
    const allResponses = [anon, strangerRes, noFile, buyerRes, sellerRes, streamMode];
    ok(
      'Nenhuma resposta contém blob.vercel-storage.com nem o file_url',
      allResponses.every((r) => !r.text.includes('blob.vercel-storage.com') && !r.text.includes(fileUrl)),
      allResponses.map((r) => r.status).join(',')
    );
    ok(
      'Nenhum Location header devolvido em falhas (sem redirect indevido)',
      allResponses.every((r) => !r.location)
    );

    /* ── 6. Upload route: proteção ── */
    console.log('\n━━━ Upload route ━━━');
    const upAnon = await api('POST', '/api/products/upload');
    ok('Upload sem sessão → 401', upAnon.status === 401, `status=${upAnon.status}`);

    const upCliente = await api('POST', '/api/products/upload', {
      token: buyer.token,
      isForm: true,
      body: new FormData(),
    });
    ok('Upload por não-vendedor → 403', upCliente.status === 403, `status=${upCliente.status}`);

    /* ── 7. Regressão rápida: produto visível, perfil OK ── */
    const prod = await api('GET', `/api/products/${productId}`);
    ok('Produto de teste visível via API', prod.status === 200 && !!prod.json?.product);
  } finally {
    /* ── 8. Limpeza ── */
    await sql`DELETE FROM orders WHERE user_id = ${buyer.user.id}`;
    await sql`DELETE FROM products WHERE id IN (${productId}, ${productIdNoFile})`;
    await sql`DELETE FROM users WHERE email IN (${sellerEmail}, ${buyerEmail}, ${strangerEmail})`;
    console.log('\n(housekeeping) fixtures de teste removidas');
  }

  console.log(`\n━━━ Resultado: ${pass} passaram, ${fail} falharam ━━━`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
