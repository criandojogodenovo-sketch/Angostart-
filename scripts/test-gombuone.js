#!/usr/bin/env node
/**
 * GOMBUONE (evolução da AngoStart) — Testes E2E do motor de campanhas.
 *
 * Testa o fluxo completo contra um servidor a correr (dev :3000):
 *
 *   G1  POST /api/auth/register/vendedor → cria vendedor de teste
 *   G2  POST /api/auth/login → login (JWT Bearer)
 *   G3  POST /api/campanhas → cria campanha (rascunho)
 *   G4  PATCH /api/campanhas/[id] → publica (ativa)
 *   G5  POST /api/campanhas/[id]/oportunidades → cria oportunidade (desconto)
 *   G6  GET /api/campanhas → lista pública contém a campanha ativa
 *   G7  POST /api/oportunidades/[id]/resgatar (sem sessão) → código GMB-
 *   G8  Re-claim (idempotência) → MESMO código (200, reused)
 *   G9  POST /api/oportunidades/validar (dono) → validado
 *   G10 Re-validar → 400 «já foi utilizado» (validação atómica)
 *   G10b Re-claim do mesmo consumidor pós-utilização → 409 (limite=1)
 *   G11 Validar código inexistente → 404
 *   G12 Visitante tenta criar campanha → 401
 *   G13 Claim de oportunidade inexistente → 404
 *   G14 Cleanup: remove campanha (cascade) + utilizador de teste
 *
 * Uso: BASE_URL=http://localhost:3000 node scripts/test-gombuone.js
 * ⚠️ NÃO correr contra produção (cria e remove dados de teste).
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = `gombuone.teste.${Date.now()}@test.ao`;
const TEST_PASSWORD = 'Gombuone!Teste123';

let passed = 0;
let failed = 0;

function check(name, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function api(method, path, { body, token, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

(async () => {
  console.log(`🚀 Testes E2E GOMBUONE contra ${BASE_URL}\n`);

  /* G1 — Registo de vendedor de teste (com KYC simulado mínimo). */
  console.log('— Setup: vendedor de teste —');
  const reg = await api('POST', '/api/auth/register/vendedor', {
    body: {
      name: 'Vendedor Teste GOMBUONE',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      telefone: '244900000000',
      cidade: 'luanda',
      area_atuacao: 'Tecnologia',
    },
  });
  const registered = reg.status === 201 || reg.status === 200;
  check('G1 registo de vendedor de teste', registered, `(status ${reg.status})`);

  /* G2 — Login. */
  const login = await api('POST', '/api/auth/login', {
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const token = login.data?.token;
  check('G2 login devolve token', login.status === 200 && !!token, `(status ${login.status})`);

  if (!token) {
    console.log('\n⚠️ Sem token — aborta (o servidor está a correr?)');
    process.exit(1);
  }

  /* G3 — Criar campanha (rascunho). */
  console.log('\n— Campanhas —');
  const create = await api('POST', '/api/campanhas', {
    token,
    body: {
      title: `Campanha de teste GOMBUONE ${Date.now()}`,
      description: 'Campanha automática de teste E2E — removida no fim.',
    },
  });
  const campaignId = create.data?.campaign?.id;
  check('G3 cria campanha (rascunho)', create.status === 201 && !!campaignId, `(status ${create.status})`);

  /* Título inválido → 400 (validação de input). */
  const badTitle = await api('POST', '/api/campanhas', {
    token,
    body: { title: 'ab' },
  });
  check('G3b título curto rejeitado (400)', badTitle.status === 400, `(status ${badTitle.status})`);

  /* G4 — Publicar. */
  const publish = await api('PATCH', `/api/campanhas/${campaignId}`, {
    token,
    body: { status: 'ativa' },
  });
  check('G4 publica campanha (ativa)', publish.status === 200 && publish.data?.campaign?.status === 'ativa');

  /* G5 — Criar oportunidade. */
  const opp = await api('POST', `/api/campanhas/${campaignId}/oportunidades`, {
    token,
    body: {
      title: 'Desconto de teste de 20%',
      kind: 'desconto',
      discount_percent: 20,
      mission_text: 'Usa o código no checkout do teste',
      total_codes: 100,
    },
  });
  const oppId = opp.data?.opportunity?.id;
  check(
    'G5 cria oportunidade (desconto 20%)',
    opp.status === 201 && !!oppId,
    `(status ${opp.status})`
  );

  /* Desconto inválido → 400. */
  const badDiscount = await api('POST', `/api/campanhas/${campaignId}/oportunidades`, {
    token,
    body: { title: 'Desconto inválido', kind: 'desconto', discount_percent: 250 },
  });
  check('G5b desconto 250% rejeitado (400)', badDiscount.status === 400, `(status ${badDiscount.status})`);

  /* G6 — Lista pública contém a campanha. */
  const list = await api('GET', '/api/campanhas');
  const found = (list.data?.campaigns ?? []).some((c) => c.id === campaignId);
  check('G6 lista pública contém a campanha ativa', list.status === 200 && found);

  /* G7 — Claim PÚBLICO (sem sessão) — cookie anónimo. */
  console.log('\n— Redemption —');
  const claim1 = await api('POST', `/api/oportunidades/${oppId}/resgatar`, {
    body: { affiliate_code: null, affiliate_sub_id: null },
  });
  const code = claim1.data?.code;
  const codeOk = typeof code === 'string' && /^GMB-[A-Z0-9]{4,12}$/.test(code);
  check('G7 claim público emite código GMB-XXXXXX', claim1.status === 201 && codeOk, `(status ${claim1.status}, code=${code})`);

  /* Extrai o cookie anónimo (httpOnly) para o 2.º claim do mesmo consumidor. */
  const anonCookie = (claim1.setCookie || '').split(';')[0];
  check('G7b cookie anónimo httpOnly definido', !!anonCookie && anonCookie.startsWith('gombuone_anon='), `(cookie=${anonCookie?.slice(0, 30)}…)`);

  /* G8 — Idempotência: mesmo consumidor → MESMO código. */
  const claim2 = await api('POST', `/api/oportunidades/${oppId}/resgatar`, {
    cookie: anonCookie,
    body: {},
  });
  check(
    'G8 re-claim idempotente devolve o MESMO código',
    claim2.status === 200 && claim2.data?.code === code && claim2.data?.reused === true,
    `(status ${claim2.status}, reused=${claim2.data?.reused})`
  );

  /* G9 — Validação pelo DONO. */
  const validate = await api('POST', '/api/oportunidades/validar', {
    token,
    body: { code },
  });
  check(
    'G9 dono valida o código',
    validate.status === 200 && validate.data?.ok === true,
    `(status ${validate.status})`
  );

  /* G10 — Re-validação → 400 (atómico). */
  const revalidate = await api('POST', '/api/oportunidades/validar', {
    token,
    body: { code },
  });
  check('G10 re-validação bloqueada (400, atómica)', revalidate.status === 400, `(status ${revalidate.status})`);

  /* G10b — Depois de USAR o código, o mesmo consumidor não pode obter outro
     (max_claims_per_consumer=1 é um limite TOTAL, não «1 ativo de cada vez»). */
  const reclaim = await api('POST', `/api/oportunidades/${oppId}/resgatar`, {
    cookie: anonCookie,
    body: {},
  });
  check(
    'G10b re-claim pós-utilização bloqueado (409, limite por consumidor)',
    reclaim.status === 409,
    `(status ${reclaim.status}, code=${reclaim.data?.code ?? '-'})`
  );

  /* G11 — Código inexistente → 404. */
  const notFound = await api('POST', '/api/oportunidades/validar', {
    token,
    body: { code: 'GMB-ZZZZZZ' },
  });
  check('G11 código inexistente → 404', notFound.status === 404, `(status ${notFound.status})`);

  /* G12 — Visitante não cria campanha → 401. */
  console.log('\n— Autorização —');
  const anonCreate = await api('POST', '/api/campanhas', {
    body: { title: 'Campanha de visitante anónimo' },
  });
  check('G12 visitante não cria campanha (401)', anonCreate.status === 401, `(status ${anonCreate.status})`);

  /* G13 — Claim de oportunidade inexistente → 404. */
  const claim404 = await api('POST', '/api/oportunidades/999999/resgatar', {
    body: {},
  });
  check('G13 claim de oportunidade inexistente (404)', claim404.status === 404, `(status ${claim404.status})`);

  /* XSS em título → sanitizado (padrão da plataforma). */
  const xss = await api('POST', '/api/campanhas', {
    token,
    body: { title: '<script>alert(1)</script> Campanha XSS Teste' },
  });
  const xssTitle = xss.data?.campaign?.title ?? '';
  check(
    'G14 título com <script> sanitizado',
    xss.status === 201 && !xssTitle.includes('<script>') && !xssTitle.includes('<'),
    `(title="${xssTitle}")`
  );

  /* G14 — Estatísticas do dono. */
  console.log('\n— Métricas —');
  const stats = await api('GET', `/api/campanhas/${campaignId}/estatisticas`, { token });
  check(
    'G15 estatísticas do dono (conversão > 0%)',
    stats.status === 200 && typeof stats.data?.stats?.total_codes === 'number',
    `(status ${stats.status})`
  );

  /* Cleanup — elimina campanhas de teste + conta de teste. */
  console.log('\n— Cleanup —');
  for (const cid of [campaignId, xss.data?.campaign?.id]) {
    if (cid) await api('DELETE', `/api/campanhas/${cid}`, { token });
  }
  // A conta de teste fica para inspeção manual se necessário — remove por SQL:
  // DELETE FROM users WHERE email LIKE 'gombuone.teste.%@test.ao';
  console.log(`  🧹 Campanhas de teste eliminadas (conta ${TEST_EMAIL} — remover por SQL se necessário).`);

  console.log(`\n📊 RESULTADO: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
