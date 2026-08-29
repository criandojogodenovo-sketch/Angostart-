/**
 * AngoStart — Testes E2E da administração dinâmica (convites + código diário).
 *
 * Uso (a password do admin total entra por env — nunca no ficheiro):
 *   env -u DATABASE_URL ADMIN_PASSWORD='...' node --env-file=.env.local \
 *     scripts/test-admin-dynamic.js
 *
 * Pressupõe servidor em http://localhost:3000 (BASE_URL para mudar).
 * Limpa os dados de teste no fim (conta teste@exemplo.com, convite, códigos).
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hellyposk@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TEST_EMAIL = 'teste@exemplo.com';
const TEST_NAME = 'Testador E2E';

if (!ADMIN_PASSWORD) {
  console.error('✗ Define ADMIN_PASSWORD na env.');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const results = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    results.push(`✔ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    results.push(`✘ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json };
}

(async () => {
  console.log(`→ Testes contra ${BASE}\n`);

  /* 1. Credenciais antigas eliminadas (contas fixas já não existem) */
  const old1 = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'conta-antiga@angostart.ao', password: 'senha-antiga-eliminada' },
  });
  check('1a contas fixas antigas não entram', old1.status === 401, `status ${old1.status}`);

  const old2 = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'validador-antigo@angostart.ao', password: 'outra-senha-antiga' },
  });
  check('1b admin_limitado fixo não entra por senha', old2.status === 401, `status ${old2.status}`);

  /* 2. Novo admin total entra */
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  check(
    '2 login admin total (novo email/senha)',
    login.status === 200 && login.json?.user?.role === 'admin',
    `status ${login.status}`
  );
  const adminToken = login.json?.token;
  if (!adminToken) {
    console.log(results.join('\n'));
    console.error('\n✗ Sem token admin — abortando (o resto depende dele).');
    process.exit(1);
  }

  /* 3. Proteções de acesso */
  const noAuth = await api('/api/admin/invites');
  check('3a GET /api/admin/invites sem token → 401', noAuth.status === 401, `status ${noAuth.status}`);

  const limitedUserLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: 'qualquersenha123' },
  });
  check(
    '3b conta de teste inexistente não entra por senha',
    limitedUserLogin.status === 401,
    `status ${limitedUserLogin.status}`
  );

  /* 4. Criar convite (email indisponível em dev → código na resposta) */
  const invite = await api('/api/admin/invites', {
    method: 'POST',
    token: adminToken,
    body: { email: TEST_EMAIL, name: TEST_NAME },
  });
  const inviteCode = invite.json?.code;
  check(
    '4 POST /api/admin/invites cria convite',
    invite.status === 201 && typeof inviteCode === 'string' && inviteCode.length === 8,
    `código ${inviteCode ?? '—'}`
  );

  const dupInvite = await api('/api/admin/invites', {
    method: 'POST',
    token: adminToken,
    body: { email: ADMIN_EMAIL },
  });
  check('4b convite para conta existente → 409', dupInvite.status === 409, `status ${dupInvite.status}`);

  /* 5. Aceitar convite */
  const badAccept = await api('/api/admin/invites/accept', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: 'ZZZZZZZZ' },
  });
  check('5a código de convite errado → 401', badAccept.status === 401, `status ${badAccept.status}`);

  const okAccept = await api('/api/admin/invites/accept', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: inviteCode },
  });
  check(
    '5b convite aceite → conta admin_limitado criada',
    okAccept.status === 200 && okAccept.json?.user?.role === 'admin_limitado' && okAccept.json?.token,
    `status ${okAccept.status}`
  );

  const reAccept = await api('/api/admin/invites/accept', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: inviteCode },
  });
  check('5c convite reutilizado → 401', reAccept.status === 401, `status ${reAccept.status}`);

  /* 6. Código diário: 1.ª tentativa sem código → 202 + envio */
  const pending = await api('/api/admin/daily-code/verify', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: '000000' },
  });
  const dailyCode = pending.json?.code;
  check(
    '6a sem código hoje → 202 pending (gera e envia)',
    pending.status === 202 && pending.json?.pending === true,
    `status ${pending.status}`
  );
  check('6b fallback dev devolve o código gerado', typeof dailyCode === 'string' && /^\d{6}$/.test(dailyCode ?? ''), dailyCode ?? '—');

  /* 7. Código diário: sucesso e uso único */
  const okDaily = await api('/api/admin/daily-code/verify', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: dailyCode },
  });
  check(
    '7a código diário correto → JWT admin_limitado',
    okDaily.status === 200 && okDaily.json?.user?.role === 'admin_limitado' && okDaily.json?.token,
    `status ${okDaily.status}`
  );

  const reuseDaily = await api('/api/admin/daily-code/verify', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: dailyCode },
  });
  check('7b código diário reutilizado → 401 (uso único)', reuseDaily.status === 401, `status ${reuseDaily.status}`);

  const wrongDaily = await api('/api/admin/daily-code/verify', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: '987654' },
  });
  check('7c código diário inválido → 401', wrongDaily.status === 401, `status ${wrongDaily.status}`);

  /* 8. Rate limit 5/min no login diário */
  let rateLimited = false;
  for (let i = 0; i < 3; i++) {
    const r = await api('/api/admin/daily-code/verify', {
      method: 'POST',
      body: { email: TEST_EMAIL, code: '111111' },
    });
    if (r.status === 429) {
      rateLimited = true;
      break;
    }
  }
  check('8 rate limit (máx. 5/min) → 429', rateLimited, 'após exceder tentativas');

  /* 9. Geração admin do código diário (rotação) */
  await new Promise((r) => setTimeout(r, 61_000)); // espera a janela de rate limit
  const gen = await api('/api/admin/daily-code/generate', {
    method: 'POST',
    token: adminToken,
    body: { admin_id: okDaily.json?.user?.id },
  });
  const newDaily = gen.json?.results?.[0]?.code;
  check(
    '9a admin gera/roda código diário',
    gen.status === 200 && typeof newDaily === 'string' && /^\d{6}$/.test(newDaily ?? ''),
    `novo código ${newDaily ?? '—'}`
  );
  check('9b código rodado é diferente do anterior', newDaily !== dailyCode);

  const okDaily2 = await api('/api/admin/daily-code/verify', {
    method: 'POST',
    body: { email: TEST_EMAIL, code: newDaily },
  });
  check('9c novo código diário válido → 200', okDaily2.status === 200, `status ${okDaily2.status}`);

  /* 10. Listagem e limpeza */
  const list = await api('/api/admin/invites', { token: adminToken });
  const testAccount = (list.json?.limitedAdmins ?? []).find((a) => a.email === TEST_EMAIL);
  check(
    '10a GET /api/admin/invites lista convites+contas+códigos',
    list.status === 200 && Array.isArray(list.json?.invites) && Array.isArray(list.json?.dailyCodes),
    `status ${list.status}`
  );
  check(
    '10b códigos diários NÃO expõem valores',
    (JSON.stringify(list.json?.dailyCodes ?? [])).match(/code_hash|"[0-9]{6}"/) === null,
    'sem hash/valor na resposta'
  );

  if (testAccount) {
    const delAdmin = await api(`/api/admin/limited-admins/${testAccount.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    check('10c remover conta admin_limitado de teste', delAdmin.status === 200, `status ${delAdmin.status}`);
  }

  const leftoverInvite = (list.json?.invites ?? []).find((i) => i.email === TEST_EMAIL);
  if (leftoverInvite) {
    const delInvite = await api(`/api/admin/invites/${leftoverInvite.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    check('10d revogar convite de teste', delInvite.status === 200, `status ${delInvite.status}`);
  }

  const cleanupLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: 'x' },
  });
  check('10e conta de teste já não existe', cleanupLogin.status === 401, `status ${cleanupLogin.status}`);

  console.log(results.join('\n'));
  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('✗ ERRO FATAL:', e);
  console.log(results.join('\n'));
  process.exit(1);
});
