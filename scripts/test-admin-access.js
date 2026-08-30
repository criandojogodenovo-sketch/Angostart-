/**
 * AngoStart — Teste de acesso do admin após troca de credenciais.
 *
 * Valida (contra servidor de produção local):
 *  1. Login com a NOVA senha → 200 + token, sem must_change_password
 *  2. Login com a senha antiga → 401 (a antiga deixa de funcionar)
 *  3. Acesso a endpoint administrativo (/api/admin/kyc) → 200
 *  4. Gestão do código diário (/api/admin/daily-code/generate, all) → 200
 *
 * Uso: BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_NEW_PASSWORD=... \
 *      ADMIN_OLD_PASSWORD=... node scripts/test-admin-access.js
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || 'hellyposk@gmail.com').toLowerCase();
const NOVA = process.env.ADMIN_NEW_PASSWORD;
const ANTIGA = process.env.ADMIN_OLD_PASSWORD;

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function api(path, { method = 'GET', token, body, ip } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, json };
}

(async () => {
  if (!NOVA) {
    console.error('❌ ADMIN_NEW_PASSWORD não definida.');
    process.exit(1);
  }
  console.log(`\n🔐 Teste de acesso admin em ${BASE}\n`);

  /* 1. Nova senha */
  const novo = await api('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: NOVA },
    ip: '172.16.20.1',
  });
  ok('Login com a nova senha → 200 + token', novo.status === 200 && Boolean(novo.json?.token), `status=${novo.status}`);
  ok(
    'Sem pedido de troca de senha (must_change_password falso/ausente)',
    novo.json?.user?.must_change_password !== true,
    JSON.stringify(novo.json?.user?.must_change_password)
  );
  const token = novo.json?.token;

  /* 2. Senha antiga (se fornecida) */
  if (ANTIGA) {
    const antigo = await api('/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: ANTIGA },
      ip: '172.16.20.2',
    });
    ok('Login com a senha antiga → 401', antigo.status === 401, `status=${antigo.status}`);
  }

  /* 3. Endpoint administrativo */
  const kyc = await api('/api/admin/kyc', { token, ip: '172.16.20.1' });
  ok('Acesso a /api/admin/kyc → 200 (painel /admin funcional)', kyc.status === 200, `status=${kyc.status} ${JSON.stringify(kyc.json?.error ?? '')}`);

  /* 4. Código diário — gestão pelo admin principal */
  const codigo = await api('/api/admin/daily-code/generate', {
    method: 'POST',
    token,
    ip: '172.16.20.1',
    body: { all: true },
  });
  ok('Gestão do código diário (generate all) → 200', codigo.status === 200, `status=${codigo.status} ${JSON.stringify(codigo.json?.error ?? '')}`);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Resultados: ${passed} ✅ · ${failed} ❌`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
