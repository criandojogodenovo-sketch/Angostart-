/**
 * AngoStart — Auditoria do VLM (verificação de comprovativos) — Fase 4.
 *
 * Estratégia:
 *  - Compila o CÓDIGO REAL de src/lib/ai-proof.ts + dependências (strip
 *    'server-only', rewrite de aliases @/lib → relativo) e corre-o em Node.
 *  - globalThis.fetch é mockado para simular respostas do VLM (extracção
 *    correcta/incorrecta/baixa confiança/garbage) — a BD é o Neon REAL.
 *  - Cada cenário cria uma encomenda de teste com comprovativo (PNG gerado
 *    em memória ou PDF raw gerado sem dependências), corre verifyOrderProof
 *    e verifica: status final, auto-aprovação e conteúdo de orders.ai_verification.
 *
 * Uso: DATABASE_URL='postgresql://...' node scripts/audit-vlm-tests.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, '.vlm-build');

try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name} ${extra}`); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

/* ── build: compilar código real ── */
function build() {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(path.join(BUILD, 'ai'), { recursive: true });
  const files = [
    ['src/lib/db.ts', 'db.ts'],
    ['src/lib/kwik.ts', 'kwik.ts'],
    ['src/lib/ai-proof.ts', 'ai-proof.ts'],
    ['src/lib/ai/chat.ts', 'ai/chat.ts'],
    ['src/lib/ai/vision.ts', 'ai/vision.ts'],
    ['src/lib/ai/providers.ts', 'ai/providers.ts'],
  ];
  for (const [src, dest] of files) {
    let code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    code = code.replace(/^import 'server-only';\s*$/m, '');
    code = code.replace(/from '@\/lib\/db'/g, "from './db'");
    code = code.replace(/from '@\/lib\/kwik'/g, "from './kwik'");
    code = code.replace(/from '@\/lib\/email'/g, "from './email'");
    code = code.replace(/from '@\/lib\/ai\/chat'/g, "from './ai/chat'");
    code = code.replace(/from '@\/lib\/ai\/vision'/g, "from './ai/vision'");
    code = code.replace(/from '@\/lib\/ai\/providers'/g, "from './ai/providers'");
    fs.writeFileSync(path.join(BUILD, dest), code);
  }
  /* email.ts → stub: emails são melhor-esforço e irrelevantes para a decisão */
  fs.writeFileSync(
    path.join(BUILD, 'email.ts'),
    ['export async function sendAdminAlertEmail(..._a: unknown[]): Promise<void> {}',
     'export async function sendOrderValidatedEmail(..._a: unknown[]): Promise<void> {}'].join('\n')
  );
  execSync(
    `npx tsc db.ts email.ts kwik.ts ai-proof.ts ai/chat.ts ai/vision.ts ai/providers.ts ` +
      `--module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck --outDir .`,
    { cwd: BUILD, stdio: 'pipe' }
  );
  return {
    aiProof: require(path.join(BUILD, 'ai-proof.js')),
    kwik: require(path.join(BUILD, 'kwik.js')),
  };
}

/* ── geradores de comprovativos (sem dependências) ── */

/** PNG 200×80 verde com "pixels" — payload sintético (o VLM é mockado). */
function makeProofPng() {
  const W = 200, H = 80;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filtro none
    for (let x = 0; x < W; x++) {
      raw[o++] = 245; raw[o++] = 248; raw[o++] = 255; // fundo claro
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcB]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PDF 1.4 mínimo com texto de comprovativo (raw, sem libs). */
function makeProofPdf(lines) {
  const text = lines
    .map((l, i) => `BT /F1 12 Tf 40 ${740 - i * 20} Td (${l.replace(/[\\()]/g, '\\$&')}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

/* ── mock do VLM ── */
const realFetch = global.fetch;
let vlmResponse = null; // {valor,data,referencia,confianca,notas} | 'GARBAGE'
let vlmCalls = 0;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/chat/completions')) {
    vlmCalls++;
    if (vlmResponse === 'GARBAGE') {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Desculpe, não consigo.' } }] }), text: async () => '' };
    }
    const content = JSON.stringify(vlmResponse);
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    };
  }
  return realFetch(url, init);
};

/* ── BD (Neon real) ── */
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
const { neon: _neon2 } = { neon: null }; // noop p/ lint

const TS = Date.now().toString(36);
const users = [];
async function setupUser(role, email) {
  const r = await sql`INSERT INTO users (name, email, password_hash, role) VALUES (${'VLM ' + email}, ${email}, ${'x'}, ${role}) RETURNING id`;
  users.push(r[0].id);
  return r[0].id;
}

/** Cria encomenda de teste com comprovativo e devolve o id. */
async function makeOrder(sellerId, clientId, totalKz, proofBuf, proofType) {
  const p = await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, user_id, featured, stock)
    VALUES (${'VLM Test Prod ' + TS}, 'produto de teste da auditoria VLM', ${totalKz}, 'produto_fisico', 'package', 'from-blue-600 to-teal-600', ${sellerId}, FALSE, 5)
    RETURNING id`;
  const prodId = p[0].id;
  const dataUrl = `data:${proofType};base64,${proofBuf.toString('base64')}`;
  const o = await sql`
    INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, delivery_address, user_id, payment_method, payment_proof, payment_proof_name, payment_proof_type)
    VALUES (${'VLM Cli ' + TS}, '923000999', ${'vlm-' + TS + '@audittest.local'},
      ${JSON.stringify([{ product_id: prodId, name: 'VLM Test Prod', price_kz: totalKz, quantity: 1, type: 'produto_fisico' }])}::jsonb,
      ${totalKz}, 'aguardando_validacao', 'domicilio', 'Bairro Teste', ${clientId}, 'kwik',
      ${dataUrl}, 'comprovativo.png', ${proofType})
    RETURNING id`;
  return { orderId: o[0].id, prodId };
}

async function cleanup() {
  // apagar por email/nome marcados com TS (encomendas/proofs incluídos)
  await sql`DELETE FROM products WHERE name LIKE 'VLM Test Prod %'`;
  await sql`DELETE FROM users WHERE email LIKE 'vlm-%@audittest.local' OR name LIKE 'VLM %'`;
  await sql`DELETE FROM orders WHERE customer_email LIKE 'vlm-%@audittest.local'`;
}

/* ── main ── */
async function main() {
  console.log('🧪 AngoStart — Auditoria VLM (comprovativos)\n');
  const { aiProof, kwik } = build();
  const {
    valorCoincide, referenciaCoincide, decideProofVerdict, verifyOrderProof,
  } = aiProof;

  process.env.B_AI_API_KEY = 'test-key-for-audit'; // provider "bai" fica disponível
  delete process.env.OPENROUTER_API_KEY;

  /* ── A. Funções puras de decisão ── */
  console.log('📐 A. Regras de decisão puras');
  check('A1 valor exacto coincide', valorCoincide(15000, 15000) === true);
  check('A2 tolerância ±1 Kz', valorCoincide(15000.5, 15000) === true && valorCoincide(14999, 15000) === true);
  check('A3 valor diferente rejeita', valorCoincide(20000, 15000) === false);
  check('A4 valor null rejeita', valorCoincide(null, 15000) === false);
  check('A5 ±0,5% para valores altos', valorCoincide(100000, 100500) === true && valorCoincide(99499, 100500) === false);
  check('A6 ref padded AngoStart-ORD-00123', referenciaCoincide('AngoStart-ORD-00123', 123) === true);
  check('A7 ref #123', referenciaCoincide('#123', 123) === true);
  check('A8 ref AS-123', referenciaCoincide('AS-123', 123) === true);
  check('A9 ref 1234 NÃO coincide com 123', referenciaCoincide('1234', 123) === false);
  check('A10 ref null rejeita', referenciaCoincide(null, 123) === false);
  check('A11 ref sem dígitos rejeita', referenciaCoincide('sem numero', 123) === false);
  const vOk = { valor: 15000, data: '2026-09-02', referencia: 'AngoStart-ORD-00099', confianca: 'alta', notas: '' };
  const d = (extraction, esperado, orderId) => decideProofVerdict(extraction, esperado, orderId);
  check('A12 veredito aprovado (tudo certo)', d(vOk, 15000, 99).verdict === 'aprovado');
  check('A13 veredito revisao (valor errado)', d({ ...vOk, valor: 20000 }, 15000, 99).verdict === 'revisao');
  check('A14 veredito revisao (ref errada)', d({ ...vOk, referencia: 'ref 987654' }, 15000, 99).verdict === 'revisao');
  check('A15 veredito revisao (confiança média)', d({ ...vOk, confianca: 'media' }, 15000, 99).verdict === 'revisao');
  check('A16 veredito revisao (confiança baixa)', d({ ...vOk, confianca: 'baixa' }, 15000, 99).verdict === 'revisao');
  check('A17 veredito revisao (valor null)', d({ ...vOk, valor: null }, 15000, 99).verdict === 'revisao');

  /* ── B. Validação de ficheiros (parseAndValidateProof) ── */
  console.log('\n📎 B. Validação de comprovativos');
  const png = makeProofPng();
  const good = kwik.parseAndValidateProof({ dataUrl: `data:image/png;base64,${png.toString('base64')}`, fileName: 'comprovativo.png' });
  check('B1 PNG válido aceite', !!good && good.mime === 'image/png' && good.bytes > 0, JSON.stringify(good).slice(0, 80));
  const pdfOk = kwik.parseAndValidateProof({ dataUrl: `data:application/pdf;base64,${makeProofPdf(['KWiK - Recibo', 'Total: 15.000,00 Kz', 'Ref: AngoStart-ORD-00099']).toString('base64')}`, fileName: 'recibo.pdf' });
  check('B2 PDF válido aceite (vai para revisão humana)', !!pdfOk && pdfOk.mime === 'application/pdf');
  const fakePhp = kwik.parseAndValidateProof({ dataUrl: `data:application/x-httpd-php;base64,${Buffer.from('<?php echo 1;').toString('base64')}`, fileName: 'x.php' });
  check('B3 PHP rejeitado', !fakePhp, JSON.stringify(fakePhp).slice(0, 80));
  const mimeLie = kwik.parseAndValidateProof({ dataUrl: `data:image/png;base64,${Buffer.from('<?php evil').toString('base64')}`, fileName: 'x.png' });
  check('B4 MIME mentiroso (conteúdo não-PNG) rejeitado', !mimeLie);
  const big = kwik.parseAndValidateProof({ dataUrl: `data:image/png;base64,${Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]).toString('base64')}`, fileName: 'big.png' });
  check('B5 ficheiro >2MB rejeitado', !big);

  /* ── C. Cenários E2E verifyOrderProof (VLM mockado + Neon real) ── */
  console.log('\n🤖 C. verifyOrderProof E2E (VLM mockado, BD real)');
  const sellerId = await setupUser('prestador_remoto', `vlm-seller-${TS}@audittest.local`);
  const clientId = await setupUser('cliente', `vlm-client-${TS}@audittest.local`);
  const pngData = makeProofPng();

  async function runScenario(name, { totalKz, refOrderPad, extraction, proofType, expect }) {
    vlmCalls = 0;
    const padded = refOrderPad !== null ? String(refOrderPad).padStart(5, '0') : null;
    // nota: a referência real é construída com o id REAL da encomenda
    const { orderId } = await makeOrder(sellerId, clientId, totalKz, pngData, proofType || 'image/png');
    vlmResponse = extraction(orderId);
    const result = await verifyOrderProof(orderId, `data:image/png;base64,${pngData.toString('base64')}`);
    const row = (await sql`SELECT status, ai_verification FROM orders WHERE id = ${orderId}`)[0];
    const audit = row.ai_verification || {};
    if (expect.pago !== undefined) check(`${name} → status pago`, (row.status === 'pago') === expect.pago, `status=${row.status}`);
    if (expect.verdict) check(`${name} → veredito ${expect.verdict}`, audit.verdict === expect.verdict, `verdict=${audit.verdict}`);
    if (expect.autoApproved !== undefined) check(`${name} → autoApproved=${expect.autoApproved}`, result.autoApproved === expect.autoApproved, `got ${result.autoApproved}`);
    if (expect.ok !== undefined) check(`${name} → ok=${expect.ok}`, result.ok === expect.ok, `got ${result.ok}, error=${result.error || '-'}`);
    if (expect.audit) check(`${name} → auditoria completa (extraído+modelo+veredicto)`,
      !!audit.extracted && !!audit.model && !!audit.verdict && audit.expected?.total_kz === totalKz,
      JSON.stringify(audit).slice(0, 100));
    await sql`DELETE FROM orders WHERE id = ${orderId}`;
    return { orderId, audit, result };
  }

  await runScenario('C1 valor+ref corretos, confiança alta', {
    totalKz: 15000, extraction: (id) => ({ valor: 15000, data: '2026-09-02', referencia: `AngoStart-ORD-${String(id).padStart(5, '0')}`, confianca: 'alta', notas: 'KWiK' }),
    expect: { ok: true, pago: true, verdict: 'aprovado', autoApproved: true, audit: true },
  });
  await runScenario('C2 valor DIFERENTE (burla)', {
    totalKz: 15000, extraction: (id) => ({ valor: 20000, data: '2026-09-02', referencia: `AngoStart-ORD-${String(id).padStart(5, '0')}`, confianca: 'alta', notas: '' }),
    expect: { ok: true, pago: false, verdict: 'revisao', autoApproved: false },
  });
  await runScenario('C3 valor certo, referência de OUTRA encomenda', {
    totalKz: 15000, extraction: () => ({ valor: 15000, data: '2026-09-02', referencia: 'AngoStart-ORD-99999', confianca: 'alta', notas: '' }),
    expect: { ok: true, pago: false, verdict: 'revisao', autoApproved: false },
  });
  await runScenario('C4 imagem desfocada (confiança média)', {
    totalKz: 15000, extraction: (id) => ({ valor: 15000, data: '2026-09-02', referencia: `AngoStart-ORD-${String(id).padStart(5, '0')}`, confianca: 'media', notas: 'borrada' }),
    expect: { ok: true, pago: false, verdict: 'revisao', autoApproved: false },
  });
  await runScenario('C5 valor ilegível (null)', {
    totalKz: 15000, extraction: () => ({ valor: null, data: null, referencia: null, confianca: 'baixa', notas: 'ilegível' }),
    expect: { ok: true, pago: false, verdict: 'revisao' },
  });
  await runScenario('C6 VLM responde lixo (sem JSON)', {
    totalKz: 15000, extraction: () => 'GARBAGE',
    expect: { ok: false, pago: false },
  });
  await runScenario('C7 tolerância ±1 Kz', {
    totalKz: 15000, extraction: (id) => ({ valor: 15000.5, data: '2026-09-02', referencia: `#${id}`, confianca: 'alta', notas: '' }),
    expect: { ok: true, pago: true, verdict: 'aprovado', autoApproved: true },
  });

  /* PDF → sempre revisão humana (nunca IA) */
  console.log('\n📄 D. PDF nunca vai para a IA');
  const { orderId: pdfOrderId } = await makeOrder(sellerId, clientId, 15000, makeProofPdf(['Total: 15.000,00 Kz', 'Ref: AngoStart-ORD-00001']), 'application/pdf');
  vlmResponse = { valor: 15000, data: '2026-09-02', referencia: 'AngoStart-ORD-00001', confianca: 'alta', notas: '' };
  vlmCalls = 0;
  const pdfResult = await verifyOrderProof(pdfOrderId, `data:application/pdf;base64,${Buffer.from('x').toString('base64')}`);
  check('D1 verifyOrderProof recusa PDF (revisão humana)', pdfResult.ok === false && /imagem/i.test(pdfResult.error || ''), JSON.stringify(pdfResult));
  check('D2 VLM NÃO foi chamado para PDF', vlmCalls === 0, `calls=${vlmCalls}`);
  await sql`DELETE FROM orders WHERE id = ${pdfOrderId}`;

  /* idempotência: re-verificar encomenda já paga */
  console.log('\n♻️  E. Re-verificação idempotente');
  const { orderId: idemId } = await makeOrder(sellerId, clientId, 15000, pngData, 'image/png');
  vlmResponse = (id) => null; vlmCalls = 0;
  vlmResponse = { valor: 15000, data: '2026-09-02', referencia: `AngoStart-ORD-${String(idemId).padStart(5, '0')}`, confianca: 'alta', notas: '' };
  await verifyOrderProof(idemId, `data:image/png;base64,${pngData.toString('base64')}`);
  const first = (await sql`SELECT status FROM orders WHERE id = ${idemId}`)[0];
  vlmResponse = { valor: 15000, data: '2026-09-02', referencia: `AngoStart-ORD-${String(idemId).padStart(5, '0')}`, confianca: 'alta', notas: '' };
  const second = await verifyOrderProof(idemId, `data:image/png;base64,${pngData.toString('base64')}`);
  const after = (await sql`SELECT status FROM orders WHERE id = ${idemId}`)[0];
  check('E1 1ª verificação aprova', first.status === 'pago', `status=${first.status}`);
  check('E2 2ª verificação: aprova sem duplicar efeitos (autoApproved=false)', second.ok === true && second.autoApproved === false && after.status === 'pago', JSON.stringify(second).slice(0, 100));
  await sql`DELETE FROM orders WHERE id = ${idemId}`;

  /* ── resultado ── */
  console.log(`\n══════════════════════════════`);
  console.log(`RESULTADO: ${pass} pass | ${fail} FAIL`);
  if (failures.length) failures.forEach((f) => console.log('  ❌ ' + f));

  await cleanup();
  console.log('🧹 Cleanup concluído (encomendas/produtos/utilizadores de teste).');
}

main()
  .then(() => { global.fetch = realFetch; process.exit(fail > 0 ? 1 : 0); })
  .catch((e) => { console.error('❌ Erro fatal:', e); process.exit(1); });
