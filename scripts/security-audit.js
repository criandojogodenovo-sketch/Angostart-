/**
 * AngoStart — AUDITORIA DE SEGURANÇA (scripts/security-audit.js)
 *
 * 70+ testes de ataque contra um build de PRODUÇÃO local:
 *   A. Headers de segurança (CSP, HSTS, X-Frame-Options…)
 *   B. XSS armazenado/refletido (sanitização)
 *   C. SQL Injection (queries parametrizadas)
 *   D. CSRF / acesso sem sessão
 *   E. Autenticação frágil (senhas comuns + brute force + rate limit)
 *   F. Autorização / IDOR (objetos de outros utilizadores)
 *   G. Upload de ficheiros maliciosos (.php/.exe/.sh, MIME falso)
 *   H. Open redirect / header injection / path traversal
 *   I. Exposição de dados sensíveis em APIs públicas
 *   J. Rate limiting
 *   K. Sessão e JWT (expiração, manipulação, escalação)
 *   L. Recuperação de senha (bug "1º link inválido" — regressão)
 *
 * Uso (build de produção Necessário — NEXT_DIST_DIR=.next-sec):
 *   NEXT_DIST_DIR=.next-sec DATABASE_URL=postgres://… JWT_SECRET='…' \
 *   [ADMIN_TEST_PASSWORD='…'] [AUDIT_BASE_URL=http://localhost:3111] \
 *   node scripts/security-audit.js
 *
 * Sem AUDIT_BASE_URL o script arranca ele próprio o servidor standalone
 * (PORT 3111), executa os testes e mata o processo no fim.
 * 🔒 Segredos apenas por ambiente — nunca hardcoded. Emails de teste
 * seguem o padrão audit.sec.*@test.ao e são REMOVIDOS no fim (cleanup SQL).
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

/* ─────────────────────────── Configuração ─────────────────────────── */

const PORT = Number(process.env.AUDIT_PORT || 3111);
const BASE = process.env.AUDIT_BASE_URL || `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const ADMIN_TEST_PASSWORD = process.env.ADMIN_TEST_PASSWORD || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'hellyposk@gmail.com').toLowerCase();
const SPAWN_SERVER = !process.env.AUDIT_BASE_URL;
const DIST_DIR = process.env.NEXT_DIST_DIR || '.next-sec';

const PASS_FIXTURE = 'Audit@Sec2026!';
const CLIENTE = { email: 'audit.sec.cliente@test.ao', name: 'Auditoria Cliente' };
const VEND_A = {
  email: 'audit.sec.venda@test.ao',
  name: 'Auditoria Vendedor <script>alert("xa")</script>',
  bi: '000000001LA001',
  birth: '1995-02-02',
};
const VEND_B = {
  email: 'audit.sec.vendb@test.ao',
  name: 'Auditoria Vendedor B',
  bi: '000000002LA002',
  birth: '1996-03-03',
};
const EMAILS_TESTE = [CLIENTE.email, VEND_A.email, VEND_B.email, 'audit.sec.xss@test.ao'];

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const secSkips = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name, reason = '') {
  skipped++;
  secSkips.push({ name, reason });
  console.log(`  ⏭️  ${name} (skip: ${reason})`);
}

function section(title) {
  console.log(`\n━━ ${title} ━━`);
}

/* ───────────────────────────── Helpers ────────────────────────────── */

async function api(pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body;
  if (opts.body !== undefined) {
    headers['Content-Type'] = opts.contentType || 'application/json';
    body = opts.contentType && opts.contentType !== 'application/json'
      ? opts.body
      : JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.method && body !== undefined ? body : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML ou vazio */
  }
  return { status: res.status, headers: res.headers, json, text: text.slice(0, 4000) };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PNG 1x1 válido (magic bytes reais). */
function pngBuffer() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000d4944415478da63fcffff3f030005fe02fea72d1e480000000049454e44ae426082',
    'hex'
  );
}

/* ─────────────── Arranque do servidor (standalone build) ───────────── */

let serverChild = null;

async function waitForServer(timeoutMs = 60_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (res.status < 600) return true;
    } catch {
      /* ainda não está de pé */
    }
    await sleep(700);
  }
  return false;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NEXT_DIST_DIR: DIST_DIR,
      DATABASE_URL,
      JWT_SECRET,
      // Sem BREVO_API_KEY → emails em modo dev no-op (nada sai para clientes)
      BREVO_API_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    delete env.BREVO_API_KEY;
    const serverJs = path.join(process.cwd(), DIST_DIR, 'standalone', 'server.js');
    serverChild = spawn('node', [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    serverChild.stdout.on('data', (d) => (out += d));
    serverChild.stderr.on('data', (d) => (out += d));
    serverChild.on('error', reject);
    serverChild.on('exit', (code) => {
      if (code && code !== 0 && !stopping) reject(new Error(`Servidor saiu (${code}):\n${out.slice(-800)}`));
    });
    // readiness fora do evento exit
    waitForServer().then((ok) => (ok ? resolve() : reject(new Error(`Timeout à espera do servidor:\n${out.slice(-800)}`))));
  });
}

function stopServer() {
  if (serverChild) {
    try {
      serverChild.kill('SIGTERM');
    } catch {
      /* ignora */
    }
    serverChild = null;
  }
}
let stopping = false;

/* ──────────────── Fixtures (SQL direto, parametrizado) ─────────────── */

let dbSql = null;
async function getDb() {
  if (!dbSql) {
    const { neon } = require('@neondatabase/serverless');
    dbSql = neon(DATABASE_URL);
  }
  return dbSql;
}

/** Sobe o sinal KYC dos vendedores de teste (a publicação exige BI verificado). */
async function aprovarKycTeste() {
  const sql = await getDb();
  await sql`UPDATE users SET is_verified_bi = TRUE, kyc_status = 'aprovado'
            WHERE email = ANY(${EMAILS_TESTE.slice(1)})`;
}

/** Cria um token de reset CONTROLADO diretamente na BD (para o fluxo E2E). */
async function inserirTokenReset(userId, { horas = 2, used = false } = {}) {
  const sql = await getDb();
  const token = crypto.randomBytes(32).toString('hex');
  await sql`
    INSERT INTO password_resets (user_id, token_hash, expires_at, used)
    VALUES (${userId}, ${sha256(token)}, now() + (${horas} || ' hours')::interval, ${used})
  `;
  return token;
}

/* ────────────────────────────── Cleanup ────────────────────────────── */

async function cleanup() {
  console.log('\n━━ Limpeza dos dados de auditoria ━━');
  if (!DATABASE_URL) {
    console.log('  (sem DATABASE_URL — limpeza SQL ignorada)');
    return;
  }
  try {
    const sql = await getDb();
    // apagar produtos dos vendedores de teste
    const prods = await sql`
      SELECT id FROM products WHERE user_id IN
        (SELECT id FROM users WHERE email = ANY(${EMAILS_TESTE}))
    `;
    const prodIds = prods.map((p) => p.id).filter((n) => Number.isInteger(n) && n > 0);
    if (prodIds.length > 0) {
      await sql`DELETE FROM reviews WHERE product_id = ANY(${prodIds})`;
      await sql`DELETE FROM products WHERE id = ANY(${prodIds})`;
    }
    const users = await sql`
      SELECT id FROM users WHERE email = ANY(${EMAILS_TESTE})
    `;
    const ids = users.map((u) => u.id).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length > 0) {
      await sql`DELETE FROM password_resets WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM notifications WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM wallet_transactions WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM suspicious_activities WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM affiliate_earnings WHERE affiliate_id IN (SELECT id FROM affiliates WHERE user_id = ANY(${ids}))`;
      await sql`DELETE FROM affiliates WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM store_followers WHERE user_id = ANY(${ids}) OR store_id IN (SELECT id FROM stores WHERE owner_id = ANY(${ids}))`;
      await sql`DELETE FROM stores WHERE owner_id = ANY(${ids})`;
      await sql`DELETE FROM wallets WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM admin_audit WHERE user_id = ANY(${ids})`;
      await sql`DELETE FROM users WHERE id = ANY(${ids})`;
    }
    console.log(`  ✅ Removidos: ${prodIds.length} produto(s), ${ids.length} conta(s) de teste.`);
  } catch (e) {
    console.log(`  ⚠️  Limpeza parcial falhou: ${e.message}`);
  }
}

/* ══════════════════════════ Bateria de testes ═══════════════════════ */

async function testarHeaders() {
  section('A. HEADERS DE SEGURANÇA');
  const res = await api('/');
  check('A1 página inicial responde 200', res.status === 200, `status ${res.status}`);
  check('A2 X-Frame-Options: DENY', res.headers.get('x-frame-options') === 'DENY');
  check('A3 X-Content-Type-Options: nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('A4 Referrer-Policy presente', !!res.headers.get('referrer-policy'));
  check('A5 Permissions-Policy presente', !!res.headers.get('permissions-policy'));
  check('A6 HSTS com max-age ≥ 1 ano', /max-age=\d{7,}/.test(res.headers.get('strict-transport-security') || ''));
  const csp = res.headers.get('content-security-policy') || '';
  check("A7 CSP com frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
  check("A8 CSP com object-src 'none' e base-uri 'self'", csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"));
  check('A9 CSP com default-src', csp.includes("default-src 'self'"));
  check('A10 sem X-Powered-By', !res.headers.get('x-powered-by'));
}

/* ────────────────────── Fixtures via API (registos) ────────────────── */

async function criarFixtures() {
  section('FIXTURES — contas de teste');
  const regCliente = await api('/api/auth/register/cliente', {
    method: 'POST',
    body: {
      name: CLIENTE.name,
      email: CLIENTE.email,
      password: PASS_FIXTURE,
      telefone: '+244901000001',
      role: 'cliente',
    },
  });
  check(
    'F1 cliente de teste registado (ou já existia)',
    [201, 200, 409].includes(regCliente.status),
    `status ${regCliente.status} ${regCliente.text.slice(0, 120)}`
  );

  for (const [i, v] of [VEND_A, VEND_B].entries()) {
    const reg = await api('/api/auth/register/vendedor', {
      method: 'POST',
      body: {
        name: v.name,
        email: v.email,
        password: PASS_FIXTURE,
        telefone: `+2449010000${i + 2}`,
        role: 'criador',
        bi_number: v.bi,
        birth_date: v.birth,
        bio: `Bio de teste da auditoria de segurança nº ${i + 1}.`,
      },
    });
    check(
      `F${i + 2} vendedor de teste registado (${v.email})`,
      [201, 200, 409].includes(reg.status),
      `status ${reg.status} ${reg.text.slice(0, 120)}`
    );
  }

  await aprovarKycTeste();

  // Garantia de fixture: força a senha conhecida (re-runs — o reset da
  // secção L pode ter trocado a senha numa execução anterior)
  const sqlf = await getDb();
  const bcryptFix = require('bcryptjs');
  await sqlf`UPDATE users SET password_hash = ${bcryptFix.hashSync(PASS_FIXTURE, 10)}
             WHERE email = ANY(${EMAILS_TESTE})`;

  const loginA = await api('/api/auth/login', {
    method: 'POST',
    body: { email: VEND_A.email, password: PASS_FIXTURE },
  });
  const loginB = await api('/api/auth/login', {
    method: 'POST',
    body: { email: VEND_B.email, password: PASS_FIXTURE },
  });
  const loginC = await api('/api/auth/login', {
    method: 'POST',
    body: { email: CLIENTE.email, password: PASS_FIXTURE },
  });
  check(
    'F4 logins dos fixtures válidos',
    loginA.json?.token && loginB.json?.token && loginC.json?.token
  );
  return {
    tokenA: loginA.json?.token,
    tokenB: loginB.json?.token,
    tokenC: loginC.json?.token,
  };
}

/* ────────────────────── B. XSS (armazenado/refletido) ──────────────── */

async function testarXSS({ tokenA }) {
  section('B. XSS — SANITIZAÇÃO DE INPUTS');

  // Registo com nome malicioso: o nome é guardado sanitizado?
  const nomeMal = '<script>alert(1)</script>Loja X <img src=x onerror=alert(2)>';
  const regXss = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: {
      name: nomeMal,
      email: 'audit.sec.xss@test.ao',
      password: PASS_FIXTURE,
      role: 'criador',
      bi_number: '000000003LA003',
      birth_date: '1994-04-04',
      bio: 'Bio de teste XSS da auditoria de segurança.',
    },
  });
  if ([201, 200, 409].includes(regXss.status)) {
    // Verificação direta na BD (sem gastar o rate limit de login)
    const sqlx = await getDb();
    const u = await sqlx`SELECT name FROM users WHERE email = 'audit.sec.xss@test.ao' LIMIT 1`;
    const nome = u[0]?.name || '';
    check('B1 <script> e onerror removidos do nome guardado', !/<script|onerror/i.test(nome), `nome: "${nome.slice(0, 60)}"`);
  } else {
    check('B1 registo com nome XSS rejeitado ou sanitizado', regXss.status === 400, `status ${regXss.status}`);
  }

  const payloads = [
    ['B2 product name com <script>', '<script>alert("x")</script>Produto Auditoria'],
    ['B3 product name com <img onerror>', 'Produto <img src=x onerror=alert(1)>'],
    ['B4 product name com <svg onload>', '<svg onload=alert(1)>Serviço'],
    ['B5 product name com iframe', '<iframe src="https://evil.example"></iframe>Item'],
  ];
  const criados = [];
  for (const [nome, payload] of payloads) {
    const res = await api('/api/products', {
      method: 'POST',
      token: tokenA,
      body: { name: payload, description: 'Descrição de teste da auditoria de segurança com mais de dez caracteres.', price: 1500, type: 'produto_fisico' },
    });
    if (res.status === 201) {
      criados.push(res.json?.product?.id);
      const id = res.json?.product?.id;
      const pub = await api(`/api/products/${id}`);
      check(nome, !/<script|onerror|onload|<iframe/i.test(pub.text), `eco bruto no produto ${id}`);
    } else {
      check(nome, res.status === 400, `status inesperado ${res.status}`);
    }
  }
  check('B6 produtos com payload criados para verificação', criados.length >= 1, `${criados.length} criados`);

  // Descrição multilinha com event handler
  const descXss = await api('/api/products', {
    method: 'POST',
    token: tokenA,
    body: {
      name: 'Produto Auditoria Desc',
      description: 'linha ok\n<script>alert(3)</script>\n<b>bold</b> fim da descricao',
      price: 2000,
      type: 'produto_fisico',
    },
  });
  if (descXss.status === 201) {
    criados.push(descXss.json?.product?.id);
    const pub = await api(`/api/products/${descXss.json?.product?.id}`);
    check('B7 <script> removido da descrição guardada', !/<script/i.test(pub.text));
  } else {
    check('B7 descrição com <script> rejeitada/sanitizada', descXss.status === 400);
  }

  // javascript: como URL de imagem
  const jsUrl = await api('/api/products', {
    method: 'POST',
    token: tokenA,
    body: { name: 'Produto Auditoria URL', description: 'Tentativa de javascript: na imagem da auditoria.', price: 900, type: 'produto_fisico', image_url: 'javascript:alert(1)' },
  });
  check('B8 image_url javascript: rejeitada', jsUrl.status === 400, `status ${jsUrl.status}`);

  // Reflexão na busca
  const q = await api('/api/products?q=<script>alert(1)</script>');
  check('B9 busca não reflete <script> bruto', !/<script>alert/i.test(q.text));

  return criados;
}

/* ────────────────────── C. SQL Injection ───────────────────────────── */

async function testarSQLi({ tokenC }) {
  section('C. SQL INJECTION — QUERIES PARAMETRIZADAS');

  const sqliEmails = [
    ["C1 login x' OR '1'='1", "x' OR '1'='1"],
    ['C2 login "; DROP TABLE users;--', "x'; DROP TABLE users;--"],
    ["C3 login ' UNION SELECT password_hash FROM users--", "' UNION SELECT password_hash FROM users--"],
    ['C4 login com aspas duplas + OR 1=1', '" OR 1=1 --'],
    ["C5 login \\'; EXEC xp_cmdshell--", "\'; EXEC xp_cmdshell--"],
  ];
  for (const [nome, payload] of sqliEmails) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: payload, password: 'Qualquer@123x' },
    });
    check(nome, res.status === 401, `status ${res.status}`);
  }

  // users continua intacta?
  const sql = await getDb();
  const usersAlive = await sql`SELECT COUNT(*)::int AS n FROM users`;
  check('C6 tabela users intacta após payloads DROP/UNION', usersAlive[0].n > 0);

  // Parâmetros de rota
  const r1 = await api(`/api/products/${encodeURIComponent("1 OR 1=1--")}`);
  check("C7 /api/products/1 OR 1=1 → 400/404 (sem leak)", [400, 404].includes(r1.status), `status ${r1.status}`);
  const r2 = await api('/api/products/abc');
  check('C8 /api/products/abc → 400', r2.status === 400, `status ${r2.status}`);
  const r3 = await api("/api/products/" + encodeURIComponent("1; DELETE FROM products;--"));
  check('C9 produto com DELETE embutido → 400/404', [400, 404].includes(r3.status), `status ${r3.status}`);

  // Query strings
  const q1 = await api("/api/products?q=" + encodeURIComponent("' OR 1=1 --"));
  check("C10 busca q=' OR 1=1 -- → 200 normal", q1.status === 200, `status ${q1.status}`);
  const q2 = await api("/api/products?type=" + encodeURIComponent("' OR 'a'='a"));
  check("C11 type=' OR… → 200 normal", q2.status === 200, `status ${q2.status}`);
  const q3 = await api("/api/stores?busca=" + encodeURIComponent("'; SELECT pg_sleep(5);--"));
  check('C12 stores com pg_sleep não trava nem falha', q3.status === 200 || q3.status === 400, `status ${q3.status}`);
  const q4 = await api("/api/portfolio/" + encodeURIComponent("x' OR '1'='1"));
  check("C13 portfolio username SQLi → sem 500", q4.status !== 500 && q4.status !== 503, `status ${q4.status}`);

  // Wallet com id manipulado
  const w = await api('/api/wallet', { token: tokenC });
  check('C14 wallet própria responde sem leak de SQL', w.status === 200 && typeof w.json?.saldo === 'number', `status ${w.status}`);

  // Sem mensagens de erro SQL no corpo
  const leak = [r1, r2, r3, q1, q2, q3, q4].some((r) => /syntax error|pg_|postgres|SQLSTATE/i.test(r.text));
  check('C15 nenhuma resposta expõe erros internos de SQL', !leak);
}

/* ────────────────────── D. CSRF / sessão ausente ───────────────────── */

async function testarCSRF() {
  section('D. CSRF — PEDIDOS SEM SESSÃO/BEARER');

  const semAuth = [
    // guest checkout é permitido por design, mas pagar com SALDO exige sessão
    ['D1 POST /api/orders (pagar com carteira)', '/api/orders', { method: 'POST', body: { payment_method: 'carteira', items: [{ product_id: 1, qty: 1 }] } }],
    ['D2 POST /api/wallet/deposit', '/api/wallet/deposit', { method: 'POST', body: { valor: 1000 } }],
    ['D3 POST /api/wallet/withdraw', '/api/wallet/withdraw', { method: 'POST', body: { valor: 1000, telefone: "244901000001" } }],
    ['D4 POST /api/admin/announcements', '/api/admin/announcements', { method: 'POST', body: { title: 'x', body: 'y' } }],
    ['D5 POST /api/admin/kyc (aprovar)', '/api/admin/kyc', { method: 'POST', body: { user_id: 1, decisao: 'aprovar' } }],
    ['D6 GET /api/admin/users', '/api/admin/users', {}],
    ['D7 POST /api/auth/2fa/verify', '/api/auth/2fa/verify', { method: 'POST', body: { code: '000000' } }],
    ['D8 GET /api/admin/report', '/api/admin/report', {}],
    ['D9 PATCH /api/admin/wallet/999 (crédito)', '/api/admin/wallet/999', { method: 'PATCH', body: { valor: 500 } }],
  ];
  for (const [nome, url, opts] of semAuth) {
    const res = await api(url, opts);
    check(`${nome} sem sessão → 401`, res.status === 401, `status ${res.status}`);
  }

  // Token válido mas role sem permissão (forjando confiança)
  const evil = await fetch(`${BASE}/api/admin/users`, {
    method: 'GET',
    headers: { Origin: 'https://site-malicioso.example' },
  });
  check('D10 admin API com Origin externo → 401', evil.status === 401, `status ${evil.status}`);
}

/* ─────────────── E. Autenticação frágil + brute force ──────────────── */

async function testarAuthFraca({ tokenC }) {
  section('E. AUTENTICAÇÃO FRÁGIL / BRUTE FORCE');

  // Senhas comuns em login (conta inexistente — sem revelar existência).
  // Nota: o limite de login (10/5min por IP) é partilhado com os testes
  // C1–C5; se o 429 chegar primeiro, o bloqueio também é pass (defesa ativa).
  const comuns = ['123456', 'password', 'qwerty123', 'letmein1'];
  for (const [i, pwd] of comuns.entries()) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'audit.sec.cliente@test.ao', password: pwd },
    });
    const bloqueado = res.status === 429;
    const rejeitado = res.status === 401 && /incorretos/i.test(res.json?.error || '');
    check(
      `E${i + 1} login com senha comum «${pwd}» → 401/429`,
      bloqueado || rejeitado,
      `status ${res.status}`
    );
  }

  // Registo com senhas fracas → política forte (Fase 9)
  const fracas = [
    ['E5 password1!', 'password1!'],
    ['E6 só minúsculas+ nº+ símbolo (sem maiúscula)', 'alllower1!'],
    ['E7 sem símbolo', 'NoSymbol123'],
    ['E8 12345678', '12345678'],
    ['E9 7 caracteres', 'Aa1!a1a'],
  ];
  for (const [nome, pwd] of fracas) {
    const res = await api('/api/auth/register/cliente', {
      method: 'POST',
      body: { name: 'Auditoria Fraca', email: `audit.sec.w${Math.random().toString(36).slice(2, 6)}@test.ao`, password: pwd, role: 'cliente' },
    });
    check(`${nome} → 400 (política forte)`, res.status === 400, `status ${res.status} ${res.text.slice(0, 80)}`);
  }

  // Brute force: rajada de 12 tentativas em segundos (limite: 10/5min por IP)
  let viu429 = false;
  let conseguiuEntrar = false;
  for (let i = 0; i < 12; i++) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'audit.sec.cliente@test.ao', password: `Errada@Brute${i}x!` },
    });
    if (res.status === 429) viu429 = true;
    if (res.status === 200) conseguiuEntrar = true;
  }
  check('E10 brute force bloqueado por rate limit (429)', viu429);
  check('E11 nenhuma tentativa da rajada entrou (sem 200)', !conseguiuEntrar);

  // Depois do esgotamento, o IP fica bloqueado (e a mensagem não enumera)
  const inexistente = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'nao-existe-certamente@angostart.ao', password: 'NaoExiste@123' },
  });
  check(
    'E12 IP bloqueado após rajada (429 persistente)',
    inexistente.status === 429,
    `status ${inexistente.status}`
  );
}

/* ────────────────────── F. IDOR / autorização ──────────────────────── */

async function testarIDOR({ tokenA, tokenB, tokenC, produtoA }) {
  section('F. IDOR — OBJETOS DE OUTROS UTILIZADORES');

  const walletC = await api('/api/wallet', { token: tokenC });
  check('F1 GET /api/wallet com sessão própria → 200', walletC.status === 200);
  const walletSem = await api('/api/wallet');
  check('F2 GET /api/wallet sem token → 401', walletSem.status === 401);

  // B tenta apagar/editar produto de A
  const delB = await api(`/api/products/${produtoA}`, { method: 'DELETE', token: tokenB });
  check('F3 vendedor B não apaga produto de A → 403', delB.status === 403, `status ${delB.status}`);
  const putB = await api(`/api/products/${produtoA}`, {
    method: 'PUT',
    token: tokenB,
    body: { name: 'Hacked pela auditoria', description: 'Tentativa de alterar produto alheio na auditoria.', price: 1 },
  });
  check('F4 vendedor B não edita produto de A → 403', putB.status === 403, `status ${putB.status}`);
  const patchB = await api(`/api/products/${produtoA}`, { method: 'PATCH', token: tokenB, body: { is_hot: true } });
  check('F5 vendedor B não altera badge de A → 403', patchB.status === 403, `status ${patchB.status}`);

  // Cliente não acede a APIs de admin
  const admUsers = await api('/api/admin/users', { token: tokenC });
  check('F6 cliente em /api/admin/users → 403', admUsers.status === 403, `status ${admUsers.status}`);
  const admKyc = await api('/api/admin/kyc', { method: 'POST', token: tokenC, body: { user_id: 1, decisao: 'aprovar' } });
  check('F7 cliente em /api/admin/kyc → 403', admKyc.status === 403, `status ${admKyc.status}`);
  const admWallet = await api('/api/admin/wallet', { token: tokenB });
  check('F8 vendedor em /api/admin/wallet → 403', admWallet.status === 403, `status ${admWallet.status}`);

  // Escalação via parâmetro
  const walletParam = await api('/api/wallet?user_id=1', { token: tokenC });
  check(
    'F9 ?user_id=1 não muda a carteira vista (resposta própria)',
    walletParam.status === 200 && JSON.stringify(walletParam.json).includes('"saldo"')
  );
  const afiliadoOutro = await api('/api/affiliate', { token: tokenC });
  check('F10 /api/affiliate de cliente sem afiliação → 200/404 sem dados de outros', [200, 404].includes(afiliadoOutro.status), `status ${afiliadoOutro.status}`);
}

/* ─────────────── G. Upload de ficheiros maliciosos ─────────────────── */

async function testarUpload({ tokenA, tokenB, tokenC }) {
  section('G. UPLOAD DE FICHEIROS MALICIOSOS (fluxo client-side)');

  /* No fluxo client-side (upload() de @vercel/blob/client) a rota recebe
     apenas o EVENTO JSON { type: 'blob.generate-client-token',
     payload: { pathname } } — o ficheiro vai direto ao Blob pré-assinado.
     A rota enforce: auth (401), corpo não-SDK (400), namespace próprio
     (400), traversal (400) e extensão (400). MIME declarado + tamanho do
     ficheiro são enforceados pelo Blob Store (allowedContentTypes +
     maximumSizeInBytes fixados server-side no token pré-assinado) e o
     serving público só acontece por /api/media com Content-Type de
     imagem + nosniff. */
  const evento = (id, name, ns = 'produtos') => ({
    type: 'blob.generate-client-token',
    payload: { pathname: `${ns}/${id}/${Date.now()}-${name}`, clientPayload: null, multipart: false },
  });
  const meuId = async (token) => {
    const me = await api('/api/auth/me', { token });
    return me.json?.user?.id;
  };
  const idA = await meuId(tokenA);
  const idC = await meuId(tokenC);
  check('G0 IDs dos fixtures obtidos (/api/auth/me)', Number.isInteger(idA) && Number.isInteger(idC), `idA=${idA} idC=${idC}`);

  // G1 sem sessão (evento SDK legítimo) → 401
  const semSessao = await fetch(`${BASE}/api/upload/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(evento(1, 'x.png')),
  });
  check('G1 upload sem sessão → 401', semSessao.status === 401, `status ${semSessao.status}`);

  // G2 corpo multipart (não-SDK) com sessão → 400 — no fluxo client-side
  // a rota só aceita o pedido de token JSON; multipart é protocolo errado.
  const fdNaoSdk = new FormData();
  fdNaoSdk.append('file', new Blob([pngBuffer()], { type: 'image/png' }), 'x.png');
  const multipartRes = await fetch(`${BASE}/api/upload/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: fdNaoSdk,
  });
  check('G2 corpo multipart (não-SDK) → 400', multipartRes.status === 400, `status ${multipartRes.status}`);

  // G3 cliente autenticado no namespace perfil/<próprio-id>/ → 200/503
  // (Fase 16: clientes podem subir FOTO DE PERFIL; 503 = Blob não
  // configurado no ambiente local — pré-validação toda passa).
  const cliente = await fetch(`${BASE}/api/upload/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(evento(idC, 'avatar.png', 'perfil')),
  });
  check('G3 cliente (avatar Fase 16) → 200/503 (nunca 401/403)', cliente.status === 200 || cliente.status === 503, `status ${cliente.status}`);

  const casos = [
    ['G4 shell PHP com extensão .php', 'shell.php', 400],
    ['G5 executável Windows .exe (MZ)', 'malware.exe', 400],
    ['G6 script .sh', 'script.sh', 400],
    ['G7 path traversal ../ no pathname', '../../ebooks/x.png', 400],
    ['G8 namespace de OUTRO utilizador', 'outeiro.png', 400, 999999],
    ['G9 dupla extensão .php.png (blob inerte — servido como image/png + nosniff)', 'shell.php.png', [200, 503]],
  ];
  for (const [nome, filename, esperados, donoId] of casos) {
    const eventoCaso = evento(donoId ?? idA, filename);
    const res = await fetch(`${BASE}/api/upload/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventoCaso),
    });
    const lista = Array.isArray(esperados) ? esperados : [esperados];
    check(`${nome} → ${lista.join('/')}`, lista.includes(res.status), `status ${res.status}`);
  }

  // positivo: evento SDK válido do vendedor B (se storage configurado)
  const ok = await fetch(`${BASE}/api/upload/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(evento(await meuId(tokenB), 'auditoria.png')),
  });
  if (ok.status === 200) {
    const j = await ok.json();
    check('G10 evento válido (PNG real) → 200 + clientToken emitido', Boolean(j?.clientToken), JSON.stringify(j).slice(0, 120));
  } else {
    skip('G10 token emitido (PNG real)', ok.status === 503 ? 'Blob não configurado' : `status ${ok.status}`);
  }
}

/* ────────── H. Open redirect / header injection / traversal ────────── */

async function testarRedirectInjection() {
  section('H. OPEN REDIRECT / HEADER INJECTION / TRAVERSAL');

  const alvos = [
    ['H1 /?next=https://evil.example', '/?next=https%3A%2F%2Fevil.example'],
    ['H2 /?redirect=//evil.example', '/?redirect=%2F%2Fevil.example'],
    ['H3 /?url=http://evil.example', '/?url=http%3A%2F%2Fevil.example'],
    ['H4 /recuperar-senha?callback=//evil.example', '/recuperar-senha?callback=%2F%2Fevil.example'],
  ];
  for (const [nome, url] of alvos) {
    const res = await fetch(`${BASE}${url}`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    check(`${nome} → sem redirect externo`, !/https?:\/\/(?!127\.0\.0\.1|localhost)evil?\.example/i.test(loc) && !/evil\.example/.test(loc), `location: ${loc}`);
  }

  // CRLF injection na query
  const crlf = await fetch(`${BASE}/api/products?q=%0d%0aX-Injected:%20yes`, { redirect: 'manual' });
  check('H5 CRLF na query não injeta header', !crlf.headers.get('x-injected'), `status ${crlf.status}`);

  // Path traversal na media
  const trav = [
    ['H6 /api/media/../ebooks/1/x.pdf', '/api/media/../ebooks/1/x.pdf'],
    ['H7 /api/media/ebooks/1/x.pdf', '/api/media/ebooks/1/x.pdf'],
    ['H8 /api/media/produtos/1/..%2f..%2febooks%2fx.pdf', '/api/media/produtos/1/..%2f..%2febooks%2fx.pdf'],
    ['H9 /api/media/%2e%2e/%2e%2e/secrets', '/api/media/%2e%2e/%2e%2e/secrets'],
  ];
  for (const [nome, url] of trav) {
    const res = await api(url);
    check(`${nome} → 404`, res.status === 404, `status ${res.status}`);
  }
}

/* ──────────────── I. Exposição de dados sensíveis ──────────────────── */

async function testarExposicao({ produtoA }) {
  section('I. EXPOSIÇÃO DE DADOS SENSÍVEIS');

  const lista = await api('/api/products');
  const corpoLista = lista.text;
  check('I1 /api/products sem chaves sensíveis (email/telefone/BI/hash)', !/"email"\s*:|"telefone"\s*:|"bi_number"|"password_hash"/i.test(corpoLista));
  check('I2 /api/products sem file_url nem stock bruto', !/"file_url"|"stock":\d/.test(corpoLista));

  const det = await api(`/api/products/${produtoA}`);
  check('I3 detalhe público sem file_url', det.status !== 200 || !/"file_url"/.test(det.text));
  check('I4 detalhe público sem seller_telefone', det.status !== 200 || !/"seller_telefone"/.test(det.text));
  check('I5 detalhe público sem bi_number', det.status !== 200 || !/bi_number/.test(det.text));

  const lojas = await api('/api/stores');
  check('I6 /api/stores sem emails/BI de donos', !/"bi_number"|password_hash/.test(lojas.text));

  const cfg = await api('/api/config');
  check('I7 /api/config sem segredos (DATABASE_URL/JWT/Brevo)', !/postgres|npg_|JWT_SECRET|BREVO|xkeysib/i.test(cfg.text));

  const meSem = await api('/api/auth/me');
  check('I8 /api/auth/me sem token → 401', meSem.status === 401);

  const monitor = await api('/api/admin/monitorizacao');
  check('I9 /api/admin/monitorizacao sem sessão → 401', monitor.status === 401);

  const cronSem = await api('/api/cron/gamification');
  check('I10 /api/cron/gamification sem CRON_SECRET → 401/403', [401, 403].includes(cronSem.status), `status ${cronSem.status}`);
}

/* ────────────────────── J. Rate limiting ───────────────────────────── */

async function testarRateLimit({ tokenC }) {
  section('J. RATE LIMITING');

  // forgot-password: 5/15min — 2 pedidos de enumeração + rajada
  const enum1 = await api('/api/auth/forgot-password', { method: 'POST', body: { email: CLIENTE.email } });
  const enum2 = await api('/api/auth/forgot-password', { method: 'POST', body: { email: 'nao-existe-nada@angostart.ao' } });
  const msg1 = enum1.json?.message || '';
  const msg2 = enum2.json?.message || '';
  check('J1 resposta do forgot idêntica com/sem conta (anti-enumeração)', enum1.status === 200 && enum2.status === 200 && msg1 === msg2, `s1=${enum1.status} s2=${enum2.status} m1=${msg1.slice(0, 30)} m2=${msg2.slice(0, 30)}`);

  let viu429Forgot = false;
  for (let i = 0; i < 5; i++) {
    const res = await api('/api/auth/forgot-password', { method: 'POST', body: { email: CLIENTE.email } });
    if (res.status === 429) viu429Forgot = true;
  }
  check('J2 forgot-password bloqueado após o limite (429)', viu429Forgot);

  // 100 pedidos em ~1 segundo no endpoint público de produtos
  const inicio = Date.now();
  const rajada = await Promise.all(
    Array.from({ length: 100 }, (_, i) => api(`/api/products?q=rajada${i}`))
  );
  const duracao = Date.now() - inicio;
  const erros500 = rajada.filter((r) => r.status >= 500).length;
  console.log(`     (100 pedidos em ${duracao}ms — ${rajada.filter((r) => r.status === 200).length} × 200)`);
  check('J3 rajada de 100 pedidos sem erros 5xx', erros500 === 0, `${erros500} respostas 5xx`);
  check('J4 rajada concluída em menos de 15s (serviço estável)', duracao < 15_000, `${duracao}ms`);

  // media: 120/min — 135 pedidos rápidos → 429
  let viu429Media = false;
  await Promise.all(
    Array.from({ length: 135 }, () =>
      api('/api/media/produtos/1/1-a.png').then((r) => {
        if (r.status === 429) viu429Media = true;
      })
    )
  );
  check('J5 /api/media limitada a 120/min (429 em rajada)', viu429Media);
}

/* ────────────────────── K. Sessão e JWT ────────────────────────────── */

async function testarJWT({ tokenC }) {
  section('K. SESSÃO E JWT');

  if (!tokenC) {
    skip('K1-K10', 'tokenC indisponível (falha nos fixtures)');
  } else {
  const me = await api('/api/auth/me', { token: tokenC });
  check('K1 token válido → 200', me.status === 200, `status ${me.status}`);

  const invalidos = [
    ['K2 token lixo', 'isto.nao.e.um.token'],
    ['K3 token vazio', ''],
    ['K4 assinatura corrompida', tokenC.slice(0, -4) + 'aaaa'],
  ];
  for (const [nome, tok] of invalidos) {
    const res = await api('/api/auth/me', { token: tok });
    check(`${nome} → 401`, res.status === 401, `status ${res.status}`);
  }

  // header "alg":"none"
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub: '1',
    email: 'hellyposk@gmail.com',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
  })}.`;
  const resNone = await api('/api/auth/me', { token: noneToken });
  check('K5 token alg:none → 401', resNone.status === 401, `status ${resNone.status}`);

  if (JWT_SECRET) {
    const jwt = require('jsonwebtoken');

    // Expirado
    const expirado = jwt.sign({ sub: '1', email: 'x@test.ao', role: 'cliente' }, JWT_SECRET, { expiresIn: -60 });
    const resExp = await api('/api/auth/me', { token: expirado });
    check('K6 token expirado → 401', resExp.status === 401, `status ${resExp.status}`);

    // Secret errado
    const segredoErrado = jwt.sign({ sub: '1', email: 'x@test.ao', role: 'cliente' }, 'segredo-errado-da-auditoria-0123456789abcdef', { expiresIn: '7d' });
    const resErr = await api('/api/auth/me', { token: segredoErrado });
    check('K7 assinado com secret errado → 401', resErr.status === 401, `status ${resErr.status}`);

    // Payload manipulado (sub de outro utilizador, assinatura do original)
    const payload = JSON.parse(Buffer.from(tokenC.split('.')[1], 'base64url').toString());
    payload.sub = '1'; // tenta ser o admin id=1/11
    payload.role = 'admin';
    const manipulado = `${tokenC.split('.')[0]}.${b64(payload)}.${tokenC.split('.')[2]}`;
    const resManip = await api('/api/auth/me', { token: manipulado });
    check('K8 payload manipulado (sub+role) → 401', resManip.status === 401, `status ${resManip.status}`);

    // Escalação de role com secret REAL — a BD é a fonte de verdade
    const sqlk = await getDb();
    let fk = await sqlk`SELECT id FROM users WHERE email = ${CLIENTE.email} LIMIT 1`;
    if (fk.length === 0) {
      // Neon pode ter um cold-start transitório — cria o fixture (não deixa
      // o teste falhar por causa de um lookup falhado, não é a intenção)
      await sqlk`
        INSERT INTO users (name, email, password_hash, role, blocked)
        VALUES (${CLIENTE.name}, ${CLIENTE.email},
                '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
                'cliente', FALSE)
        ON CONFLICT (email) DO NOTHING
      `;
      fk = await sqlk`SELECT id FROM users WHERE email = ${CLIENTE.email} LIMIT 1`;
    }
    const clienteId = fk[0]?.id;
    if (!clienteId) {
      skip('K9 role admin forjado → 403', 'fixture cliente indisponível (BD)');
      skip('K10 /api/auth/me role da BD', 'fixture cliente indisponível (BD)');
    } else {
    const fakeAdmin = jwt.sign({ sub: String(clienteId), email: CLIENTE.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    const resFake = await api('/api/admin/users', { token: fakeAdmin });
    check('K9 role admin forjado no JWT não concede acesso (BD manda) → 403', resFake.status === 403, `status ${resFake.status} body=${resFake.text.slice(0, 160)}`);
    const meFake = await api('/api/auth/me', { token: fakeAdmin });
    check('K10 /api/auth/me com role forjado devolve role da BD', meFake.status === 401 || meFake.json?.user?.role === 'cliente', `role: ${meFake.json?.user?.role}`);
    }
  } else {
    skip('K6-K10 JWT com secret', 'JWT_SECRET não fornecida ao script');
  }
  }

  // daily-code exige CRON_SECRET
  const cronSem = await api('/api/admin/daily-code/generate', { method: 'POST' });
  check('K11 daily-code generate sem segredo → 401', [401, 403].includes(cronSem.status), `status ${cronSem.status}`);
}

/* ─────────── L. Recuperação de senha (regressão do bug) ────────────── */

async function testarResetSenha({ tokenC }) {
  section('L. RECUPERAÇÃO DE SENHA — BUG DO 1º LINK');

  // GET não pode consumir token (405 — só existe POST)
  const getReset = await api('/api/auth/reset-password', { method: 'GET' });
  check('L1 GET /api/auth/reset-password → 405 (abrir o link não consome)', getReset.status === 405, `status ${getReset.status}`);

  // Formato inválido
  const formatoRuim = await api('/api/auth/reset-password', { method: 'POST', body: { token: 'xyz', password: 'Nova@Senha2026x' } });
  check('L2 token em formato inválido → 400', formatoRuim.status === 400);

  // FLUXO E2E com token controlado: criar → reset (1ª tentativa!) → login
  const sql = await getDb();
  const rows = await sql`SELECT id FROM users WHERE email = ${CLIENTE.email} LIMIT 1`;
  const uid = rows[0]?.id;
  if (!uid) {
    skip('L3-L6 fluxo E2E do reset', 'cliente de teste ausente');
    return;
  }

  const senhaNova = 'Auditoria@Nova2026!';
  const token1 = await inserirTokenReset(uid, { horas: 2 });
  const reset1 = await api('/api/auth/reset-password', { method: 'POST', body: { token: token1, password: senhaNova } });
  check('L3 1ª tentativa de reset funciona (bug corrigido)', reset1.status === 200 && !!reset1.json?.token, `status ${reset1.status} ${reset1.text.slice(0, 100)}`);

  const reset2 = await api('/api/auth/reset-password', { method: 'POST', body: { token: token1, password: senhaNova } });
  check('L4 token reutilizado → 400 (uso único)', reset2.status === 400, `status ${reset2.status}`);

  const tokenExp = await inserirTokenReset(uid, { horas: -1 });
  const resetExp = await api('/api/auth/reset-password', { method: 'POST', body: { token: tokenExp, password: senhaNova } });
  check('L5 token expirado → 400 com mensagem clara', resetExp.status === 400 && /expir/i.test(resetExp.json?.error || ''), `status ${resetExp.status}`);

  // Política forte também no reset
  const tokenFraco = await inserirTokenReset(uid, { horas: 2 });
  const resetFraco = await api('/api/auth/reset-password', { method: 'POST', body: { token: tokenFraco, password: 'fraca123' } });
  check('L6 senha fraca no reset → 400 (política forte)', resetFraco.status === 400, `status ${resetFraco.status}`);

  // Invalidação de tokens anteriores ao gerar novo (Gmail thread!)
  await api('/api/auth/forgot-password', { method: 'POST', body: { email: CLIENTE.email } });
  await sleep(150);
  const pendentes1 = await sql`
    SELECT COUNT(*)::int AS n FROM password_resets
    WHERE user_id = ${uid} AND used = FALSE
  `;
  await api('/api/auth/forgot-password', { method: 'POST', body: { email: CLIENTE.email } });
  await sleep(150);
  const estado = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE used = FALSE)::int AS ativos,
      COUNT(*) FILTER (WHERE expires_at > now())::int AS futuros
    FROM password_resets WHERE user_id = ${uid}
  `;
  check('L7 novo pedido invalida links anteriores (só 1 ativo)', estado[0].ativos === 1 && estado[0].total > pendentes1[0].n, `ativos: ${estado[0].ativos} total: ${estado[0].total} pendentes1: ${pendentes1[0].n}`);
  check('L8 novo token com validade de 2 horas', estado[0].futuros >= 1);

  // A senha definida no reset ficou mesmo guardada? (bcrypt na BD —
  // sem gastar o rate limit de login, já esgotado pelas secções C/E)
  const posReset = await sql`SELECT password_hash FROM users WHERE id = ${uid} LIMIT 1`;
  const bcrypt = require('bcryptjs');
  const senhaOk = posReset[0]?.password_hash
    ? bcrypt.compareSync(senhaNova, posReset[0].password_hash)
    : false;
  check('L9 nova senha guardada corretamente (bcrypt na BD)', senhaOk);
}

/* ───────────────────── Runner principal ────────────────────────────── */

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  AngoStart — AUDITORIA DE SEGURANÇA (70+ testes)');
  console.log(`  Alvo: ${BASE}`);
  console.log('══════════════════════════════════════════════════════');

  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL em falta (a auditoria limpa os próprios dados).');
    process.exit(1);
  }

  if (SPAWN_SERVER) {
    console.log('\n▶ A arrancar servidor standalone de produção…');
    await startServer();
    console.log('▶ Servidor pronto.');
  }

  try {
    await testarHeaders();

    const fx = await criarFixtures();

    // Produto do vendedor A (para IDOR + exposição)
    const prod = await api('/api/products', {
      method: 'POST',
      token: fx.tokenA,
      body: {
        name: 'Produto Auditoria Principal',
        description: 'Produto criado pela auditoria de segurança para testes de IDOR e exposicao.',
        price: 2500,
        type: 'produto_fisico',
      },
    });
    const produtoA = prod.json?.product?.id;
    check('F0 produto de teste criado pelo vendedor A', prod.status === 201 && Number.isInteger(produtoA), `status ${prod.status}`);
    if (!Number.isInteger(produtoA)) {
      console.error('❌ Sem produto de teste — testes de IDOR ficam limitados.');
    }

    // Admin: login com a NOVA senha (valida rotação por SQL) — 1 só chamada
    // para não esgotar o rate limit de login partilhado (10/5min por IP)
    if (ADMIN_TEST_PASSWORD) {
      section('ADMIN — ROTAÇÃO DE CREDENCIAIS');
      const admNew = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_TEST_PASSWORD } });
      check('M1 login admin com nova senha → 200', admNew.status === 200, `status ${admNew.status} ${admNew.text.slice(0, 80)}`);
    }

    const criadosXss = await testarXSS(fx);
    await testarSQLi(fx);
    await testarCSRF();
    await testarAuthFraca(fx);
    await testarIDOR({ ...fx, produtoA });
    await testarUpload(fx);
    await testarRedirectInjection();
    await testarExposicao({ produtoA });
    // L antes de J: o teste de invalidação usa o quota de forgot-password
    // (5/15min) antes da rajada de rate limiting de J
    await testarJWT(fx);
    await testarResetSenha(fx);
    await testarRateLimit(fx);
  } finally {
    stopping = true;
    if (SPAWN_SERVER) stopServer();
    await cleanup();
  }

  /* ── Relatório ── */
  const total = passed + failed + skipped;
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${passed}/${total} passaram · ${failed} falhas · ${skipped} skips`);
  console.log('══════════════════════════════════════════════════════');
  if (failures.length) {
    console.log('\n❌ FALHAS:');
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  if (secSkips.length) {
    console.log('\n⏭️  SKIPS:');
    for (const s of secSkips) console.log(`  • ${s.name} — ${s.reason}`);
  }

  // Relatório JSON (gitignored — só local)
  try {
    const fs = require('fs');
    const dir = path.join(process.cwd(), DIST_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'security-audit-report.json'),
      JSON.stringify({ data: new Date().toISOString(), base: BASE, passed, failed, skipped, failures, skips: secSkips }, null, 2)
    );
    console.log(`\n📄 Relatório: ${DIST_DIR}/security-audit-report.json`);
  } catch {
    /* sem relatório em disco — consola basta */
  }

  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { main };

if (require.main === module) {
  main().catch(async (e) => {
    console.error('\n💥 ERRO FATAL DA AUDITORIA:', e);
    stopping = true;
    stopServer();
    await cleanup();
    process.exit(1);
  });
}
