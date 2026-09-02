#!/usr/bin/env node
/**
 * test-fase17-e2e.js — Testes E2E das 4 melhorias (Fase 17).
 *
 * Cobre os 5 fluxos pedidos:
 *  1. Registo com termos NÃO aceites → 400 (API bloqueia)
 *  2. Registo com termos aceites → conta criada + aceitou_termos=TRUE na BD
 *  3. Vendedor → loja criada automaticamente + PATCH de personalização OK
 *  4. Login devolve profile_image (base do avatar em tempo real)
 *  5. Afiliado não-membro → /api/affiliate 404 (base do botão escondido)
 *  + regressão: upload de avatar grava e /api/auth/me reflete a foto
 *
 * Uso: node scripts/test-fase17-e2e.js   (requer dev server na 3000)
 * Cada teste usa x-forwarded-for próprio (evita rate limit em re-runs).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

/* .env → env (sem sobrescrever a shell, mas normalizando aspas) */
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* opcional */ }

const { neon } = require('@neondatabase/serverless');
/* A shell pode trazer DATABASE_URL=file: (stub da plataforma) — se a env
   efetiva não for postgres, força o valor lido do .env. */
let DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL.startsWith('postgresql')) {
  const envLine = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  DATABASE_URL = (envLine?.[1] || '').replace(/^["']|["']$/g, '');
}
if (!DATABASE_URL.startsWith('postgresql')) {
  console.error('❌ DATABASE_URL real em falta no .env (stub da plataforma?)');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name} ${extra}`); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

const STAMP = Date.now();
const SENHA = 'Fase17@Test2026!';
const emails = [
  `fase17.c.no@test.ao`,
  `fase17.c.sim@test.ao`,
  `fase17.v.sim@test.ao`,
].map((e) => e.replace('.ao', `.${STAMP}.ao`));

function ip() { return `10.${(STAMP % 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; }

async function api(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip(), ...(opts.headers || {}) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* corpo vazio */ }
  return { status: res.status, json };
}

async function cleanup() {
  try {
    const rows = await sql`SELECT id FROM users WHERE email = ANY(${emails})`;
    for (const r of rows) {
      await sql`DELETE FROM stores WHERE owner_id = ${r.id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${r.id}`.catch?.(() => {});
    }
    await sql`DELETE FROM users WHERE email = ANY(${emails})`;
  } catch { /* best-effort */ }
}

async function main() {
  await cleanup();
  console.log('\n🧪 FASE 17 — E2E das 4 melhorias\n' + '─'.repeat(70));

  /* ── Fluxo 1: registo SEM termos → 400 ── */
  const semTermos = await api('/api/auth/register/cliente', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fase17 Sem Termos', email: emails[0], password: SENHA, telefone: '+244901000001' }),
  });
  check('F1 registo sem aceitarTermos → 400', semTermos.status === 400, `got ${semTermos.status}`);
  check('F1 mensagem de erro clara', /termos de servi/i.test(semTermos.json?.error || ''), semTermos.json?.error);
  const noDb = await sql`SELECT id FROM users WHERE email = ${emails[0]}`;
  check('F1 nenhum utilizador criado na BD', noDb.length === 0);

  /* ── Fluxo 2: registo COM termos → 201 + BD TRUE ── */
  const comTermos = await api('/api/auth/register/cliente', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fase17 Com Termos', email: emails[1], password: SENHA, telefone: '+244901000002', aceitarTermos: true }),
  });
  check('F2 registo com aceitarTermos → 201', comTermos.status === 201, `got ${comTermos.status} ${JSON.stringify(comTermos.json || {}).slice(0, 120)}`);
  check('F2 resposta tem token + user', !!comTermos.json?.token && !!comTermos.json?.user);
  const dbC = await sql`SELECT id, aceitou_termos::boolean AS ok FROM users WHERE email = ${emails[1]}`;
  check('F2 BD: aceitou_termos = TRUE', dbC[0]?.ok === true);

  /* ── Fluxo 3: vendedor → loja automática + PATCH personalização ── */
  const vendedor = await api('/api/auth/register/vendedor', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Fase17 Vendedor Loja', email: emails[2], password: SENHA,
      telefone: '+244901000003', role: 'criador', bio: 'Vendedor de teste da Fase 17 com loja.',
      aceitarTermos: true,
    }),
  });
  check('F3 registo vendedor → 201', vendedor.status === 201, `got ${vendedor.status} ${JSON.stringify(vendedor.json || {}).slice(0, 120)}`);
  const vId = vendedor.json?.user?.id;
  const vTok = vendedor.json?.token;
  const dbV = await sql`SELECT aceitou_termos::boolean AS ok FROM users WHERE id = ${vId}`;
  check('F3 BD vendedor: aceitou_termos = TRUE', dbV[0]?.ok === true);
  const store = await sql`SELECT id, name, slug FROM stores WHERE owner_id = ${vId}`;
  check('F3 loja criada automaticamente no registo', store.length === 1, `stores=${store.length}`);

  const vSemLoja = vendedor.status === 201 ? await api('/api/stores', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${vTok}` },
    body: JSON.stringify({ name: 'Loja Fase17', description: 'Loja personalizada no E2E da Fase 17.', logo_url: '', banner_url: '' }),
  }) : { status: 0, json: {} };
  check('F3 PATCH /api/stores personaliza a loja → ok', vSemLoja.status === 200 && vSemLoja.json?.ok === true, `got ${vSemLoja.status}`);
  const store2 = await sql`SELECT name, description FROM stores WHERE owner_id = ${vId}`;
  check('F3 BD: loja com nome/descrição personalizados', store2[0]?.name === 'Loja Fase17', JSON.stringify(store2[0]));

  /* ── Fluxo 4: login devolve profile_image (avatar em tempo real) ── */
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: emails[1], password: SENHA }),
  });
  check('F4 login → 200', login.status === 200, `got ${login.status}`);
  check('F4 login devolve campo profile_image', 'profile_image' in (login.json?.user || {}), JSON.stringify(Object.keys(login.json?.user || {})));

  /* ── Fluxo 5 (avatar): upload grava + /api/auth/me reflete ── */
  const tokC = login.json?.token;
  const urlFoto = `/api/media/perfil/${dbC[0].id}/${STAMP}-foto-perfil.jpg`;
  const avatarPost = await api('/api/perfil/avatar', {
    method: 'POST',
    headers: { authorization: `Bearer ${tokC}` },
    body: JSON.stringify({ profile_image: urlFoto }),
  });
  check('A1 POST avatar → ok:true', avatarPost.status === 200 && avatarPost.json?.ok === true, `got ${avatarPost.status} ${JSON.stringify(avatarPost.json || {})}`);
  const me = await api('/api/auth/me', { headers: { authorization: `Bearer ${tokC}` } });
  check('A2 /api/auth/me reflete profile_image', me.json?.user?.profile_image === urlFoto, `got ${me.json?.user?.profile_image}`);
  const dbFoto = await sql`SELECT profile_image FROM users WHERE id = ${dbC[0].id}`;
  check('A3 BD: profile_image gravado', dbFoto[0]?.profile_image === urlFoto);
  const avatarSemAuth = await api('/api/perfil/avatar', { method: 'POST', body: JSON.stringify({ profile_image: urlFoto }) });
  check('A4 avatar sem sessão → 401', avatarSemAuth.status === 401, `got ${avatarSemAuth.status}`);

  /* ── Fluxo 5 (afiliado): não-membro → 404 (botão escondido na UI) ── */
  const aff = await api('/api/affiliate', { headers: { authorization: `Bearer ${tokC}` } });
  check('F5 não-afiliado: /api/affiliate → 404', aff.status === 404, `got ${aff.status}`);
  const affSemAuth = await api('/api/affiliate');
  check('F5 /api/affiliate sem sessão → 401', [401, 403].includes(affSemAuth.status), `got ${affSemAuth.status}`);

  /* ── Migração: coluna existe e é NOT NULL DEFAULT FALSE ── */
  const col = await sql`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='users' AND column_name='aceitou_termos'`;
  check('MIG coluna aceitou_termos presente (NOT NULL, default false)', col[0]?.is_nullable === 'NO' && col[0]?.column_default === 'false', JSON.stringify(col[0]));

  console.log('\n' + '─'.repeat(70));
  console.log(`RESULTADO: ${pass} pass · ${fail} FAIL`);
  if (fail) { console.log('Falhas:\n - ' + failures.join('\n - ')); }

  console.log('\n🧹 Cleanup…');
  await cleanup();
  console.log('✅ Concluído.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('💥', e); cleanup().finally(() => process.exit(1)); });
