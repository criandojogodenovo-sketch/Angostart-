#!/usr/bin/env node
/**
 * perf-audit.js — Auditoria de performance AngoStart (FASE 2)
 *
 * Mede latência das rotas principais contra o build standalone de produção
 * (.next-sec) e imprime tabela avg/p50/p95 + diagnóstico de gargalos:
 *  - Latência de rede até à BD Neon (esperada dominante fora da Vercel)
 *  - Queries N+1 (grep estático em src/app/api)
 *  - Índices ausentes em tabelas quentes (products, orders, users)
 *
 * Uso: node scripts/perf-audit.js   (assume scripts/run-security-audit.sh já correu 1x → .next-sec existe)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = '.next-sec';

function readEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => {
    const m = raw.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '') : '';
  };
  return { DATABASE_URL: get('DATABASE_URL'), JWT_SECRET: get('JWT_SECRET') };
}

function wait(port, ms = 30000) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const ping = () => {
      fetch(BASE).then((r) => res(r.status)).catch(() => {
        if (Date.now() - t0 > ms) return rej(new Error('timeout servidor'));
        setTimeout(ping, 400);
      });
    };
    ping();
  });
}

async function timeOnce(url, opts = {}) {
  const t0 = process.hrtime.bigint();
  let status = 0;
  try {
    const r = await fetch(BASE + url, opts);
    status = r.status;
    await r.arrayBuffer();
  } catch { status = -1; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, status };
}

async function measure(name, url, opts = {}, n = 12) {
  // warmup (compilação/primeira query)
  for (let i = 0; i < 2; i++) await timeOnce(url, opts);
  const xs = [];
  let statuses = new Set();
  for (let i = 0; i < n; i++) {
    const { ms, status } = await timeOnce(url, opts);
    xs.push(ms);
    statuses.add(status);
  }
  xs.sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p = (q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  console.log(`${name.padEnd(34)} avg=${avg.toFixed(0).padStart(6)}ms  p50=${p(0.5).toFixed(0).padStart(6)}ms  p95=${p(0.95).toFixed(0).padStart(6)}ms  status=[${[...statuses].join(',')}]`);
  return avg;
}

async function main() {
  const env = readEnv();
  if (!env.DATABASE_URL.startsWith('postgresql')) {
    console.error('❌ .env sem DATABASE_URL real (stub da plataforma?) — corre scripts/verify-uploads.js');
    process.exit(1);
  }
  const server = spawn('node', [path.join(DIST, 'standalone', 'server.js')], {
    env: { ...process.env, ...env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', BREVO_API_KEY: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverErr = '';
  server.stderr.on('data', (d) => (serverErr += d));
  server.on('exit', (c) => { if (c) console.error('servidor saiu', c, serverErr.slice(-400)); });

  try {
    await wait(PORT);
    console.log(`\n⏱️  Latências (${BASE}, build standalone; BD Neon remota)\n${'─'.repeat(80)}`);

    // público
    await measure('GET / (homepage SSR)', '/');
    await measure('GET /api/products?limit=24', '/api/products?limit=24');
    await measure('GET /api/products (paginação+search)', '/api/products?q=servico&limit=12');
    await measure('GET /api/stores', '/api/stores');
    await measure('GET /api/config', '/api/config');
    await measure('GET /api/announcements', '/api/announcements');

    // auth: criar conta efémera + medir login (com spacing p/ evitar rate limit)
    const email = `perf.${Date.now()}@test.ao`;
    const senha = 'Perf@Audit2026!';
    const reg = await fetch(`${BASE}/api/auth/register/cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: senha, name: 'Perf Audit', telefone: '+24490109999', role: 'cliente' }),
    }).catch(() => null);
    if (!reg || ![200, 201, 409].includes(reg.status)) {
      console.log(`(registo de teste falhou: ${reg ? reg.status : 'erro rede'} — rotas autenticadas serão ignoradas)`);
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const loginOnce = async () => {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: senha }),
      });
      await r.arrayBuffer();
      return r.status;
    };
    // warmup + medição espaçada (rate limit do login ~5/min)
    await sleep(300);
    const ltimes = [];
    let lst = new Set();
    for (let i = 0; i < 4; i++) {
      const t0 = process.hrtime.bigint();
      lst.add(await loginOnce());
      ltimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (i < 3) await sleep(9500);
    }
    ltimes.sort((a, b) => a - b);
    console.log(`${'POST /api/auth/login (bcrypt)'.padEnd(34)} avg=${(ltimes.reduce((a, b) => a + b, 0) / ltimes.length).toFixed(0).padStart(6)}ms  p50=${ltimes[Math.floor(ltimes.length / 2)].toFixed(0).padStart(6)}ms  p95=${ltimes[ltimes.length - 1].toFixed(0).padStart(6)}ms  status=[${[...lst].join(',')}]`);

    // autenticado (pausa para o rate limit de login resetar)
    await sleep(10000);
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    const lj = await login.json().catch(() => ({}));
    const token = lj.token || lj?.user?.token || '';
    if (token) {
      const H = { authorization: `Bearer ${token}` };
      await measure('GET /api/auth/me', '/api/auth/me', { headers: H });
      await measure('GET /api/orders', '/api/orders', { headers: H });
      await measure('GET /api/wallet', '/api/wallet', { headers: H });
      await measure('GET /api/notifications', '/api/notifications', { headers: H });
      // limpar conta efémera
      try {
        const { neon } = require('@neondatabase/serverless');
        const env2 = readEnv();
        await neon(env2.DATABASE_URL)`DELETE FROM users WHERE email = ${email}`;
      } catch { /* cleanup best-effort */ }
    } else {
      console.log('(sem token — rotas autenticadas ignoradas)');
    }

    // N+1 estático: await sql dentro de for/of
    console.log(`\n🔍 Possíveis N+1 (await sql dentro de loop):\n${'─'.repeat(80)}`);
    const { execSync } = require('child_process');
    const files = execSync(`rg -l "for\\s*\\(|forEach" src/app/api --glob route.ts 2>/dev/null || true`, { shell: '/bin/bash' }).toString().trim().split('\n').filter(Boolean);
    let nFound = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const lines = src.split('\n');
      let inLoop = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/for\s*\(|\.forEach\(/.test(lines[i])) inLoop = 1;
        else if (inLoop && /^\s*}\s*$/.test(lines[i])) inLoop = 0;
        if (inLoop && /await\s+(sql|dbSql)\s*`/.test(lines[i])) {
          console.log(`  ${f}:${i + 1}`);
          nFound++;
        }
      }
    }
    if (!nFound) console.log('  (nenhum padrão óbvio — OK)');

    // índices das tabelas quentes
    console.log(`\n🗂️  Índices nas tabelas quentes (Neon):\n${'─'.repeat(80)}`);
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(env.DATABASE_URL);
    const idx = await sql`SELECT tablename, indexname FROM pg_indexes
                          WHERE tablename IN ('products','orders','users','stores','comments','reviews','notifications')
                          ORDER BY tablename, indexname`;
    const byT = {};
    for (const r of idx) (byT[r.tablename] ||= []).push(r.indexname);
    for (const t of Object.keys(byT).sort()) console.log(`  ${t}: ${byT[t].join(', ')}`);

    console.log(`\n✅ Auditoria de performance concluída.`);
  } finally {
    try { server.kill('SIGTERM'); } catch { /* */ }
  }
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
