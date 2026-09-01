/**
 * AngoStart — Testes E2E da Fase 8
 *
 * Cobre:
 *  1. Novos métodos de pagamento manuais (PayPay, Multicaixa Express)
 *     - POST /api/orders aceita payment_method 'paypay' | 'multicaixa_express'
 *     - Comprovativo anexado → status aguardando_validacao
 *     - POST /api/orders/[id]/proof preserva o método (regressão do bug 'kwik')
 *  2. Upload real de imagens de produto
 *     - POST /api/upload/image (auth, MIME, tamanho, magic bytes)
 *     - GET /api/media/[...path] público, apenas namespace produtos/
 *     - products POST/PUT aceitam URL interno /api/media/produtos/…
 *  3. Admin: filtro por método (GET /api/admin/orders?method=…) + validação
 *  4. Segurança: 401 sem sessão, 403 sem permissão, paths proibidos → 404
 *
 * Executar:
 *   1) npm run build && node node_modules/next/dist/bin/next start -p 3459
 *   2) node --env-file=.env scripts/test-fase8.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

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

async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('application/json')) {
    const json = await res.json().catch(() => null);
    return { status: res.status, data: json };
  }
  return { status: res.status, data: null, buffer: await res.arrayBuffer() };
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
const SELLER = {
  name: 'Vendedor Fase 8',
  email: `f8vendedor${uniq}@teste.ao`,
  password: 'TesteFase8!x',
  telefone: '+244923000333',
  role: 'prestador_remoto',
  bio: 'Prestador remoto de testes da Fase 8 com experiência comprovada.',
  especialidade: 'design',
};
const CLIENT = {
  name: 'Cliente Fase 8',
  email: `f8cliente${uniq}@teste.ao`,
  password: 'TesteFase8!x',
  telefone: '+244923000444',
};

/** JPEG mínimo válido (magic bytes FF D8 FF) — 1×1 pixel vermelho. */
function tinyJpeg() {
  return Buffer.from(
    'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFC0000B080001000101011100FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC400B5100002010303020403050504040000017D01020300041105122131410613516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A3435363738393A434445464748494A535455565758595A636465666768696A737475767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFDA0008010100003F00FBFE8A28A2800A28A2800A28A2803FFD9',
    'hex'
  );
}

/** PDF mínimo válido (%PDF-) — usado como comprovativo. */
function tinyPdf() {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\nxref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n0\n%%EOF',
    'latin1'
  );
}

function pdfDataUrl() {
  return `data:application/pdf;base64,${tinyPdf().toString('base64')}`;
}

/* ─────────── Verificação de código-fonte ─────────── */
function sourceChecks() {
  console.log('━━━ Fase 8 — verificação de código-fonte ━━━');

  const orders = fs.readFileSync('src/app/api/orders/route.ts', 'utf8');
  check('orders: importa isManualTransferMethod', orders.includes("from '@/lib/payments-manual'"));
  check('orders: aceita métodos manuais via type guard', orders.includes('isManualTransferMethod(body.payment_method)'));

  const proof = fs.readFileSync('src/app/api/orders/[id]/proof/route.ts', 'utf8');
  check('proof: NÃO força mais payment_method = kwik', !proof.includes("payment_method = 'kwik'"));
  check('proof: preserva método manual existente', proof.includes('isManualTransferMethod(order.payment_method)'));

  const upload = fs.readFileSync('src/app/api/upload/image/route.ts', 'utf8');
  check('upload/image: evento JSON parsed p/ handleUpload (client-side)', upload.includes('body: peek as HandleUploadBody') && upload.includes('blob.generate-client-token'));
  check('upload/image: MIME fixado server-side (jpeg/png/webp)', upload.includes("'image/jpeg'") && upload.includes("'image/png'") && upload.includes("'image/webp'"));
  check('upload/image: limite 5 MB', upload.includes('5 * 1024 * 1024'));
  check('upload/image: namespace próprio (produtos|perfil/<id>/)', upload.includes('ALLOWED_PREFIXES') && upload.includes('ownedPrefixes'));
  check('upload/image: autenticação (requireRole)', upload.includes('requireRole(request)'));

  const media = fs.readFileSync('src/app/api/media/[...path]/route.ts', 'utf8');
  check('media: regex restrita a produtos/ e perfil/', media.includes('/^(?:produtos|perfil)\\/\\d+\\/\\d{13}-[A-Za-z0-9._-]{1,120}$/'));
  check('media: cache imutável', media.includes('immutable'));
  check('media: 404 para paths fora de produtos/', media.includes('status: 404'));

  const products = fs.readFileSync('src/app/api/products/route.ts', 'utf8');
  check('products POST: aceita URL interno /api/media', products.includes('isInternalMediaUrl(imageUrl)'));

  const carrinho = fs.readFileSync('src/app/carrinho/page.tsx', 'utf8');
  check('carrinho: radios PayPay + Multicaixa Express', carrinho.includes("value=\"paypay\"") && carrinho.includes("value=\"multicaixa_express\""));
  check('carrinho: instruções partilhadas p/ métodos manuais', carrinho.includes('isManualTransferMethod(paymentMethod)'));
  check('carrinho: envia comprovativo p/ métodos manuais', carrinho.includes('isManualTransferMethod(paymentMethod) &&'));

  const form = fs.readFileSync('src/app/adicionar-produto/page.tsx', 'utf8');
  check('form produto: upload client-side (uploadFileSmart → api/upload/image)', form.includes('uploadFileSmart') && form.includes("'/api/upload/image'"));
  check('form produto: aceita 5MB/JPG/PNG/WebP', form.includes('PRODUCT_IMAGE_MAX_BYTES'));
  check('form produto: ainda suporta link externo (retrocompat.)', form.includes('Preferes usar um link externo?'));

  const admin = fs.readFileSync('src/app/api/admin/orders/route.ts', 'utf8');
  check('admin orders: filtro method param', admin.includes('VALID_METHODS.includes(methodParam)'));

  const adminPage = fs.readFileSync('src/app/admin/page.tsx', 'utf8');
  check('admin página: chips de filtro por método', adminPage.includes('METHOD_FILTERS'));

  const proofList = fs.readFileSync('src/components/ProofReviewList.tsx', 'utf8');
  check('ProofReviewList: badge de método dinâmico', proofList.includes('PAYMENT_METHOD_LABELS[order.payment_method]'));

  const email = fs.readFileSync('src/lib/email.ts', 'utf8');
  check('email: instruções por método (PayPay/Multicaixa)', email.includes('methodLabel'));
}

/* ─────────── Testes E2E ─────────── */
async function main() {
  sourceChecks();

  console.log('\n━━━ Fase 8 — setup (utilizadores) ━━━');
  const sellerToken = await register(SELLER.name, SELLER.email, SELLER.password, SELLER.role, {
    bio: SELLER.bio,
    especialidade: SELLER.especialidade,
  });
  check('vendedor registado/autenticado', Boolean(sellerToken));
  const clientToken = await register(CLIENT.name, CLIENT.email, CLIENT.password, 'cliente');
  check('cliente registado/autenticado', Boolean(clientToken));

  // KYC: BI obrigatório para publicar (Fase 6) — setado direto na BD como no teste F7
  const sellerRows = (await sql`SELECT id FROM users WHERE email = ${SELLER.email}`) ?? [];
  const sellerId = sellerRows[0]?.id;
  await sql`UPDATE users SET bi_number = ${'00' + uniq + 'LA080'} WHERE id = ${sellerId}`;

  console.log('\n━━━ Fase 8 — upload de imagens (client-side) ━━━');

  const anonUpload = await api('POST', '/api/upload/image', {
    body: { type: 'blob.generate-client-token', payload: { pathname: `produtos/1/x-${uniq}.png` } },
  });
  check('upload sem sessão → 401', anonUpload.status === 401 || anonUpload.status === 403, `got ${anonUpload.status}`);

  // Corpo que NÃO é evento do SDK (multipart com ficheiro) — rejeitado:
  // no fluxo client-side a rota só aceita o pedido de token JSON.
  const badForm = new FormData();
  badForm.append('file', new Blob([Buffer.from('isto não é uma imagem')], { type: 'text/plain' }), 'nota.txt');
  const badMime = await api('POST', '/api/upload/image', { token: sellerToken, raw: badForm });
  check('upload corpo não-SDK (multipart) → 400', badMime.status === 400, `got ${badMime.status}`);

  // Evento SDK com namespace de OUTRO utilizador → 400
  const wrongNs = await api('POST', '/api/upload/image', {
    token: sellerToken,
    body: { type: 'blob.generate-client-token', payload: { pathname: `produtos/999999/x-${uniq}.jpg` } },
  });
  check('upload namespace alheio → 400', wrongNs.status === 400, `got ${wrongNs.status}`);

  // Evento SDK com extensão proibida (executável disfarçado) → 400
  const badExt = await api('POST', '/api/upload/image', {
    token: sellerToken,
    body: { type: 'blob.generate-client-token', payload: { pathname: `produtos/${sellerId}/script-${uniq}.exe` } },
  });
  check('upload extensão .exe → 400', badExt.status === 400, `got ${badExt.status}`);

  // Evento SDK válido — o token REAL do Blob só existe na Vercel; localmente
  // a rota valida o pedido (auth, rate limit, namespace, extensão) e responde
  // 503 sem crash e sem leak. Na Vercel (com token) responde 200 + clientToken
  // e o browser faz PUT direto do ficheiro ao Blob (5 MB máx., jpeg/png/webp).
  const okUpload = await api('POST', '/api/upload/image', {
    token: sellerToken,
    body: { type: 'blob.generate-client-token', payload: { pathname: `produtos/${sellerId}/produto-${uniq}.jpg` } },
  });
  if (okUpload.status === 200) {
    check('upload evento válido → 200 + clientToken', Boolean(okUpload.data?.clientToken), JSON.stringify(okUpload.data).slice(0, 120));
  } else {
    check(
      'upload evento válido → 503 local (sem crash, sem leak)',
      okUpload.status === 503 && !JSON.stringify(okUpload.data).includes('vercel_blob_rw'),
      `got ${okUpload.status} ${JSON.stringify(okUpload.data)}`
    );
    console.log('  ℹ️  (BLOB_READ_WRITE_TOKEN real só na Vercel — caminho feliz do Blob valida-se em produção)');
  }
  // URL sintático válido para testar a aceitação do products API
  let mediaUrl = `/api/media/produtos/${sellerId}/${uniq}-foto-teste.jpg`;

  // Paths proibidos
  check('media: path ebooks/ → 404', (await api('GET', '/api/media/ebooks/1/1700000000000-x.pdf')).status === 404);
  check('media: traversal → 404', (await api('GET', '/api/media/produtos/1/1700000000000-..%2Febooks')).status === 404);
  check('media: path mal formado → 404', (await api('GET', '/api/media/produtos/1/nao-existe.jpg')).status === 404);
  const missingBlob = (await api('GET', '/api/media/produtos/1/1700000000000-foto-fantasma.jpg')).status;
  check(
    'media: blob inexistente → 404/502 (503 sem token Blob local)',
    [404, 502, 503].includes(missingBlob),
    `got ${missingBlob}`
  );

  console.log('\n━━━ Fase 8 — produto com foto real ━━━');

  const anonProduct = await api('POST', '/api/products', {
    body: { name: 'X', description: 'abcdefgh', price: 100, type: 'produto_fisico', image_url: mediaUrl },
  });
  check('product POST sem sessão → 401', anonProduct.status === 401 || anonProduct.status === 403, `got ${anonProduct.status}`);

  const product = await api('POST', '/api/products', {
    token: sellerToken,
    body: {
      name: `Foto Real F8 ${uniq}`,
      description: 'Produto de teste da Fase 8 com foto enviada da galeria.',
      price: 3500,
      type: 'produto_fisico',
      image_url: mediaUrl,
    },
  });
  check('product POST com URL interno → 201', product.status === 201, JSON.stringify(product.data));
  const productId = product.data?.product?.id;
  const savedImage = product.data?.product?.image_url;
  check('produto guarda image_url interno', savedImage === mediaUrl, `got ${savedImage}`);

  const badImage = await api('POST', '/api/products', {
    token: sellerToken,
    body: {
      name: `Imagem Estranha F8 ${uniq}`,
      description: 'Tentativa de injectar URL não permitido.',
      price: 3500,
      type: 'produto_fisico',
      image_url: '/api/media/ebooks/1/x.jpg',
    },
  });
  check('product POST com /api/media/ebooks → 400', badImage.status === 400, `got ${badImage.status}`);

  // PUT também aceita URL interno
  const putProduct = await api('PUT', `/api/products/${productId}`, {
    token: sellerToken,
    body: { price: 4200 },
  });
  check('product PUT mantém imagem interna', putProduct.status === 200 && putProduct.data?.product?.image_url === mediaUrl);

  console.log('\n━━━ Fase 8 — encomendas PayPay / Multicaixa Express ━━━');

  const paypayOrder = await api('POST', '/api/orders', {
    token: clientToken,
    body: {
      customer_name: CLIENT.name,
      customer_phone: CLIENT.telefone,
      items: [{ id: productId, quantity: 1 }],
      payment_method: 'paypay',
      payment_proof: pdfDataUrl(),
      payment_proof_name: `comprovativo-paypay-${uniq}.pdf`,
    },
  });
  check('order paypay + comprovativo → 201 aguardando_validacao', paypayOrder.status === 201 && paypayOrder.data?.order?.status === 'aguardando_validacao', JSON.stringify(paypayOrder.data));
  check('order paypay ecoa método', paypayOrder.data?.order?.payment_method === 'paypay');
  const paypayId = paypayOrder.data?.order?.id;

  const mcxOrder = await api('POST', '/api/orders', {
    token: clientToken,
    body: {
      customer_name: CLIENT.name,
      customer_phone: CLIENT.telefone,
      items: [{ id: productId, quantity: 1 }],
      payment_method: 'multicaixa_express',
    },
  });
  check('order multicaixa_express sem comprovativo → pendente', mcxOrder.status === 201 && mcxOrder.data?.order?.status === 'pendente', JSON.stringify(mcxOrder.data));
  const mcxId = mcxOrder.data?.order?.id;

  // Comprovativo tardio preserva multicaixa_express (regressão do bug)
  const lateProof = await api('POST', `/api/orders/${mcxId}/proof`, {
    token: clientToken,
    body: {
      payment_proof: pdfDataUrl(),
      payment_proof_name: `comprovativo-mcx-${uniq}.pdf`,
    },
  });
  check('proof tardio → aguardando_validacao', lateProof.status === 200 && lateProof.data?.order?.status === 'aguardando_validacao', JSON.stringify(lateProof.data));

  const mcxRows = (await sql`SELECT payment_method FROM orders WHERE id = ${mcxId}`) ?? [];
  check('regressão: método multicaixa_express preservado no proof tardio', mcxRows[0]?.payment_method === 'multicaixa_express', `got ${mcxRows[0]?.payment_method}`);

  console.log('\n━━━ Fase 8 — filtro por método no admin ━━━');

  const adminEmail = process.env.ADMIN_EMAIL || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  let adminToken = null;
  if (adminEmail && adminPassword) {
    const adminLogin = await api('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPassword } });
    adminToken = adminLogin.data?.token ?? null;
  }

  if (adminToken) {
    const anonAdmin = await api('GET', '/api/admin/orders?method=paypay');
    check('admin orders sem sessão → 401', anonAdmin.status === 401);

    const sellerAdmin = await api('GET', '/api/admin/orders?method=paypay', { token: sellerToken });
    check('admin orders com vendedor → 403', sellerAdmin.status === 403, `got ${sellerAdmin.status}`);

    const paypayFilter = await api('GET', '/api/admin/orders?status=aguardando_validacao&method=paypay', { token: adminToken });
    const paypayIds = (paypayFilter.data?.orders ?? []).map((o) => o.id);
    check('filtro method=paypay devolve só a encomenda paypay', paypayFilter.status === 200 && paypayIds.includes(paypayId) && !paypayIds.includes(mcxId), JSON.stringify(paypayIds));

    const mcxFilter = await api('GET', '/api/admin/orders?status=aguardando_validacao&method=multicaixa_express', { token: adminToken });
    const mcxIds = (mcxFilter.data?.orders ?? []).map((o) => o.id);
    check('filtro method=multicaixa_express devolve só a encomenda mcx', mcxFilter.status === 200 && mcxIds.includes(mcxId) && !mcxIds.includes(paypayId), JSON.stringify(mcxIds));

    const methodField = paypayFilter.data?.orders?.find((o) => o.id === paypayId)?.payment_method;
    check('lista admin inclui campo payment_method (badge)', methodField === 'paypay');

    // Valida a encomenda PayPay → pago (escrow/efeitos existentes intactos)
    const approve = await api('PATCH', `/api/admin/orders/${paypayId}`, {
      token: adminToken,
      body: { status: 'pago', admin_note: 'Teste F8 — valor confirmado.' },
    });
    check('admin aprova encomenda paypay → pago', approve.status === 200 && approve.data?.order?.status === 'pago', JSON.stringify(approve.data));

    const methodInvalid = await api('GET', '/api/admin/orders?method=slack', { token: adminToken });
    check('filtro method inválido é ignorado (não quebra)', methodInvalid.status === 200);
  } else {
    console.log('  (sem ADMIN_PASSWORD no env — validação de admin na BD)');
    const paypayRows = (await sql`SELECT payment_method, status FROM orders WHERE id = ${paypayId}`) ?? [];
    check('encomenda paypay registada na BD', paypayRows[0]?.payment_method === 'paypay');
    const mcxRows2 = (await sql`SELECT payment_method FROM orders WHERE id = ${mcxId}`) ?? [];
    check('encomenda multicaixa_express registada na BD', mcxRows2[0]?.payment_method === 'multicaixa_express');
  }

  console.log(`\n━━━ Resultado: ${passed} ✓ / ${failed} ✗ ━━━`);
  if (failures.length) {
    console.log('Falhas:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
