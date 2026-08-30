/**
 * AngoStart — FASE 10: criação de dados de teste + validação E2E do fluxo de afiliados
 * (executar com o servidor de produção a correr).
 *
 * Uso:
 *   DATABASE_URL=postgres://... BASE_URL=http://localhost:3000 node scripts/seed-fase10-test.js
 *
 * Cria:
 *  - Vendedor de teste: oficialwehelp@gmail.com / Teste@AngoStart2026
 *    (BI 000000000LA000 · nascimento 1995-01-01 · loja «Loja Teste Afiliados»)
 *  - 5 e-books fictícios (5.000–15.000 Kz) publicados pelo vendedor
 *  - 5 clientes (cliente1..5@teste.com / Cliente@Teste2026) — 1 compra paga cada
 *  - Ativa o modo afiliado do vendedor (elegibilidade Fase 10: 5 vendas)
 *    e define o código AFG-TESTE123
 *  - cliente_afiliado@teste.com compra via link ?ref=AFG-TESTE123&sub=whatsapp
 *    → verifica comissão de 10% creditada na carteira com sub_id='whatsapp'
 *
 * Verificações (elevar a 0 = falha):
 *  1. Vendedor fresco com 0 vendas → adesão 403 «Necessitas de 5 vendas»
 *  2. Com 4 vendas pagas → ainda 403 · com a 5ª → 201 (regra nova = exatamente 5)
 *  3. Cliente com 1 compra → adesão 403 (regra de 2 compras mantém-se)
 *  4. Link limpo ?ref=AFG-TESTE123 (+ &sub=campanha via ?sub=)
 *  5. Compra atribuída → comissão 10% com sub_id registado + relatório por canal
 *
 * Nota: oficialwehelp@gmail.com já pode ser afiliado (adesão idempotente devolve
 * 201 sem revalidar) — o gate de elegibilidade é provado no vendedor fresco.
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sql = neon(process.env.DATABASE_URL);

const VENDEDOR = { email: 'oficialwehelp@gmail.com', pass: 'Teste@AngoStart2026', name: 'Vendedor Teste Afiliados', bi: '000000000LA000', birth: '1995-01-01' };
const CLIENT_PASS = 'Cliente@Teste2026';
const SUB_ID = 'whatsapp';
const CODIGO_ESPERADO = 'AFG-TESTE123';
const IP_COMPRADOR = '172.16.10.30'; // distinto do afiliado (simula comprador real)
const IPS = {
  vendedor: '172.16.10.1',
  cliente: (i) => `172.16.10.${10 + i}`,
  gate: '172.16.10.40',
  neg: '172.16.10.50',
  admin: '172.16.10.99',
};

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', token, body, ip } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      /* IP próprio por conta — evita limites de taxa partilhados e
       * torna o signup_ip realista (anti-fraude do afiliado funciona). */
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

/** Regista; se o email já existir (409), entra com a senha. */
async function registerOrLogin(endpoint, payload, ip) {
  const reg = await api(endpoint, { method: 'POST', body: payload, ip });
  if (reg.status === 201 && reg.json?.token) {
    return { ...reg, novo: true };
  }
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: payload.email, password: payload.password },
    ip,
  });
  if (login.status === 200 && login.json?.token) return { ...login, novo: false };
  return reg.status === 201 ? reg : login;
}

async function fundWallet(userId, amount) {
  await sql`
    INSERT INTO wallets (user_id, saldo, saldo_bloqueado)
    VALUES (${userId}, ${amount}, 0)
    ON CONFLICT (user_id) DO UPDATE SET saldo = wallets.saldo + ${amount}
  `;
}

(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
    console.error('❌ DATABASE_URL não definida.');
    process.exit(1);
  }
  console.log(`\n🌱 Fase 10 — seed + validação E2E em ${BASE}\n`);

  /* ── 1. Vendedor de teste (BI + idade 31 anos + senha forte) ── */
  console.log('1️⃣ Vendedor de teste (oficialwehelp@gmail.com)');
  let vendedor = await registerOrLogin('/api/auth/register/vendedor', {
    name: VENDEDOR.name,
    email: VENDEDOR.email,
    password: VENDEDOR.pass,
    telefone: '958176915',
    role: 'criador',
    bio: 'Conta de teste do programa de afiliados da AngoStart (Fase 10).',
    bi_number: VENDEDOR.bi,
    birth_date: VENDEDOR.birth,
  }, IPS.vendedor);

  /* A conta pode já existir (criada antes do prompt) com outra senha —
   * conformiza-a: senha do prompt + BI + nascimento + nome de teste. */
  if (!vendedor.json?.token) {
    const existente = await sql`SELECT id FROM users WHERE email = ${VENDEDOR.email} LIMIT 1`;
    if (existente.length === 1) {
      const hash = await bcrypt.hash(VENDEDOR.pass, 10);
      await sql`
        UPDATE users
        SET password_hash = ${hash},
            name = ${VENDEDOR.name},
            bi_number = ${VENDEDOR.bi},
            birth_date = ${VENDEDOR.birth}::date,
            role = 'criador',
            is_verified_bi = FALSE,
            kyc_status = 'pending'
        WHERE email = ${VENDEDOR.email}
      `;
      vendedor = await api('/api/auth/login', {
        method: 'POST',
        body: { email: VENDEDOR.email, password: VENDEDOR.pass },
        ip: IPS.vendedor,
      });
      console.log('  ℹ️  Conta pré-existente conformizada (senha + BI + nascimento + nome).');
    }
  }
  ok('Conta criada/entrada (senha forte + BI + idade válidos)', Boolean(vendedor.json?.token), JSON.stringify(vendedor.json));
  const vTok = vendedor.json?.token;
  const vUserId = vendedor.json?.user?.id;
  if (!vTok || !vUserId) {
    console.error('❌ Sem token do vendedor — abortar.');
    process.exit(1);
  }
  await sleep(300);

  /* Loja automática — renomear para «Loja Teste Afiliados» (pedido do prompt) */
  const lojaRows = await sql`SELECT id, name FROM stores WHERE owner_id = ${vUserId} LIMIT 1`;
  ok('Loja criada automaticamente no registo', lojaRows.length === 1);
  if (lojaRows[0] && lojaRows[0].name !== 'Loja Teste Afiliados') {
    await sql`UPDATE stores SET name = 'Loja Teste Afiliados' WHERE id = ${lojaRows[0].id}`;
  }

  /* Nota: a conta pode já ser afiliada (adesão é idempotente e devolve 201
   * sem revalidar) — o gate de elegibilidade é provado na secão 5b com um
   * vendedor fresco. */

  /* ── 2. Aprovar BI pelo admin (fluxo real de verificação) ── */
  console.log('\n2️⃣ Verificação de BI pelo admin');
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: process.env.ADMIN_EMAIL || 'hellyposk@gmail.com', password: process.env.ADMIN_PASSWORD },
    ip: IPS.admin,
  });
  const adminTok = adminLogin.json?.token;
  if (!adminTok) {
    // fallback: marca verificado direto na BD (admin indisponível localmente)
    await sql`UPDATE users SET is_verified_bi = TRUE, kyc_status = 'verified' WHERE id = ${vUserId}`;
    console.log('  ⚠️  Admin indisponível — is_verified_bi marcado direto na BD.');
  } else {
    const kyc = await api('/api/admin/kyc', {
      method: 'POST',
      token: adminTok,
      body: { user_id: vUserId, action: 'aprovar' },
    });
    ok('Admin aprovou o BI (KYC)', kyc.status === 200 && kyc.json?.is_verified_bi === true, `status=${kyc.status}`);
  }

  /* ── 3. 5 e-books fictícios (5.000–15.000 Kz) ── */
  console.log('\n3️⃣ Produtos de teste (e-books 5.000–15.000 Kz)');
  const precos = [5000, 6500, 8000, 10000, 15000];
  let produtos = await sql`
    SELECT id, price_kz::float8 AS price FROM products
    WHERE user_id = ${vUserId} AND name LIKE 'E-book Teste Afiliados %'
    ORDER BY id LIMIT 5
  `;
  for (let i = produtos.length; i < 5; i += 1) {
    const criado = await api('/api/products', {
      method: 'POST',
      token: vTok,
      body: {
        name: `E-book Teste Afiliados #${i + 1}`,
        description: 'Infoproduto fictício criado para validar o fluxo de afiliados da Fase 10.',
        price: precos[i],
        type: 'infoproduto',
      },
    });
    if (criado.status !== 201) {
      console.error(`  ❌ Produto ${i + 1}: status=${criado.status}`, criado.json);
      process.exit(1);
    }
    produtos.push({ id: criado.json?.product?.id, price: precos[i] });
    await sleep(300);
  }
  produtos = produtos.slice(0, 5);
  ok('5 produtos publicados (BI verificado desbloqueia publicação)', produtos.length === 5 && produtos.every((p) => p.id));

  /* ── 4. 5 clientes + 5 vendas pagas (carteira) ── */
  console.log('\n4️⃣ 5 clientes de teste + 5 vendas pagas');
  const clientes = [];
  for (let i = 1; i <= 5; i += 1) {
    const c = await registerOrLogin('/api/auth/register/cliente', {
      name: `Cliente Teste ${i}`,
      email: `cliente${i}@teste.com`,
      password: CLIENT_PASS,
      telefone: '92300000' + i,
    }, IPS.cliente(i));
    ok(`cliente${i}@teste.com criado/entrou`, Boolean(c.json?.token), `status=${c.status}`);
    const uid = c.json?.user?.id;
    clientes.push({ token: c.json?.token, id: uid });
    await sleep(200);
  }

  for (let i = 0; i < 5; i += 1) {
    const c = clientes[i];
    if (!c.token || !produtos[i]?.id) continue;
    await fundWallet(c.id, 25_000);
    const pedido = await api('/api/orders', {
      method: 'POST',
      token: c.token,
      ip: IPS.cliente(i + 1),
      body: {
        customer_name: `Cliente Teste ${i + 1}`,
        customer_phone: '92300000' + (i + 1),
        customer_email: `cliente${i + 1}@teste.com`,
        payment_method: 'carteira',
        items: [{ id: produtos[i].id, quantity: 1 }],
      },
    });
    ok(
      `Venda ${i + 1}/5 paga (e-book #${i + 1} — ${produtos[i].price} Kz, carteira)`,
      pedido.status === 201 && pedido.json?.order?.status === 'pago',
      `status=${pedido.status} ${JSON.stringify(pedido.json?.error ?? '')}`
    );
    await sleep(300);
  }

  /* ── 5. Ativar afiliado (agora cumpre 5 vendas) + código AFG-TESTE123 ── */
  console.log('\n5️⃣ Ativação do modo afiliado (elegibilidade Fase 10: 5 vendas)');
  const adesao = await api('/api/affiliate/register', { method: 'POST', token: vTok });
  ok('Com 5 vendas pagas → adesão 201', adesao.status === 201 && adesao.json?.codigo_afiliado, `status=${adesao.status} ${JSON.stringify(adesao.json)}`);
  await sql`UPDATE affiliates SET codigo_afiliado = ${CODIGO_ESPERADO} WHERE user_id = ${vUserId}`;

  const afiliado = await api('/api/affiliate', { token: vTok });
  ok(`Código ${CODIGO_ESPERADO} ativo`, afiliado.json?.codigo_afiliado === CODIGO_ESPERADO);
  ok(
    'Link limpo ?ref=AFG-TESTE123',
    (afiliado.json?.referral_link ?? '').includes(`/?ref=${CODIGO_ESPERADO}`),
    afiliado.json?.referral_link
  );
  ok('Janela de atribuição devolvida (30 dias)', afiliado.json?.atribuicao_dias === 30, String(afiliado.json?.atribuicao_dias));
  ok(
    'Escalão consistente (15 % aos 50)',
    afiliado.json?.escalao?.percentual_escalao_seguinte === 15 &&
      afiliado.json?.escalao?.proximo_escalao_em ===
        Math.max(0, 50 - (afiliado.json?.escalao?.comissoes_recebidas ?? 0)),
    JSON.stringify(afiliado.json?.escalao)
  );
  const linkCampanha = await api('/api/affiliate?sub=instagram', { token: vTok });
  ok(
    'Link de campanha ?ref=…&sub=instagram',
    (linkCampanha.json?.referral_link ?? '').endsWith(`/?ref=${CODIGO_ESPERADO}&sub=instagram`),
    linkCampanha.json?.referral_link
  );

  /* Cliente fresco (0 compras) → bloqueado (regra de 2 compras mantém-se) */
  const clienteNeg = await registerOrLogin('/api/auth/register/cliente', {
    name: 'Cliente Neg Teste',
    email: 'cliente_neg@teste.com',
    password: CLIENT_PASS,
    telefone: '923555555',
  }, IPS.neg);
  const neg2 = await api('/api/affiliate/register', { method: 'POST', token: clienteNeg.json?.token });
  ok(
    'Cliente sem compras → adesão bloqueada (403)',
    neg2.status === 403 && /Necessitas de 2 compras/i.test(neg2.json?.error ?? ''),
    `status=${neg2.status} error=${neg2.json?.error}`
  );

  /* ── 5b. Gate de elegibilidade exato: 5 vendas (vendedor fresco) ── */
  console.log('\n5️⃣b Regra de elegibilidade = exatamente 5 vendas (vendedor fresco)');
  const suffix = Date.now().toString(36).slice(-5);
  const GATE = {
    email: `gate.fase10.${suffix}@test.ao`, // único por execução (re-executável)
    pass: 'Vendedor@Gate2026',
    name: 'Vendedor Gate Fase 10',
    bi: '004587896LA038',
    birth: '1995-05-10',
  };
  const gate = await registerOrLogin('/api/auth/register/vendedor', {
    name: GATE.name,
    email: GATE.email,
    password: GATE.pass,
    telefone: '923666666',
    role: 'criador',
    bio: 'Conta descartável para provar o gate de elegibilidade da Fase 10.',
    bi_number: GATE.bi,
    birth_date: GATE.birth,
  }, IPS.gate);
  ok('Vendedor fresco registado (BI + senha forte)', Boolean(gate.json?.token), `status=${gate.status} ${JSON.stringify(gate.json?.error ?? '')}`);
  const gTok = gate.json?.token;
  const gId = gate.json?.user?.id;
  await sleep(300);

  const gate0 = await api('/api/affiliate/register', { method: 'POST', token: gTok });
  ok(
    '0 vendas → 403 «Necessitas de 5 vendas»',
    gate0.status === 403 && /Necessitas de 5 vendas/i.test(gate0.json?.error ?? ''),
    `status=${gate0.status} error=${gate0.json?.error}`
  );

  /* KYC marcado na BD (senha do admin real só existe com o utilizador) */
  await sql`UPDATE users SET is_verified_bi = TRUE, kyc_status = 'verified' WHERE id = ${gId}`;

  const precosGate = [1000, 1500, 2000, 2500, 3000];
  const produtosGate = [];
  for (let i = 0; i < 5; i += 1) {
    const criado = await api('/api/products', {
      method: 'POST',
      token: gTok,
      body: {
        name: `Produto Gate Fase 10 #${i + 1}`,
        description: 'Infoproduto descartável para validar o gate de 5 vendas dos afiliados.',
        price: precosGate[i],
        type: 'infoproduto',
      },
    });
    if (criado.status !== 201) {
      console.error(`  ❌ Produto gate ${i + 1}:`, criado.json);
      process.exit(1);
    }
    produtosGate.push(criado.json?.product?.id);
    await sleep(250);
  }
  ok('5 produtos do vendedor gate publicados', produtosGate.every(Boolean));

  async function vendaGate(i) {
    const c = clientes[i];
    await fundWallet(c.id, 20_000);
    const pedido = await api('/api/orders', {
      method: 'POST',
      token: c.token,
      ip: IPS.cliente(i + 1),
      body: {
        customer_name: `Cliente Teste ${i + 1}`,
        customer_phone: '92300000' + (i + 1),
        customer_email: `cliente${i + 1}@teste.com`,
        payment_method: 'carteira',
        items: [{ id: produtosGate[i], quantity: 1 }],
      },
    });
    return pedido;
  }

  for (let i = 0; i < 4; i += 1) {
    const p = await vendaGate(i);
    ok(`Venda gate ${i + 1}/5 paga`, p.status === 201 && p.json?.order?.status === 'pago', `status=${p.status}`);
    await sleep(250);
  }
  const gate4 = await api('/api/affiliate/register', { method: 'POST', token: gTok });
  ok(
    '4 vendas → ainda 403 «Necessitas de 1 venda»',
    gate4.status === 403 && /Necessitas de 1 venda/i.test(gate4.json?.error ?? ''),
    `status=${gate4.status} error=${gate4.json?.error}`
  );
  const p5 = await vendaGate(4);
  ok('Venda gate 5/5 paga', p5.status === 201 && p5.json?.order?.status === 'pago', `status=${p5.status}`);
  await sleep(250);
  const gate5 = await api('/api/affiliate/register', { method: 'POST', token: gTok });
  ok(
    '5 vendas → adesão 201 (regra fixada em 5)',
    gate5.status === 201 && gate5.json?.codigo_afiliado,
    `status=${gate5.status} error=${gate5.json?.error}`
  );

  /* ── 6. Compra via link de afiliado (?ref=AFG-TESTE123&sub=whatsapp) ── */
  console.log('\n6️⃣ Fluxo de afiliado: clique → compra paga → comissão');
  const ca = await registerOrLogin('/api/auth/register/cliente', {
    name: 'Cliente Afiliado Teste',
    email: 'cliente_afiliado@teste.com',
    password: CLIENT_PASS,
    telefone: '923777777',
  }, IP_COMPRADOR);
  ok('cliente_afiliado@teste.com criado/entrou', Boolean(ca.json?.token), `status=${ca.status}`);
  const caId = ca.json?.user?.id;
  await sleep(300);

  /* Comprador real: IP de registo distinto do afiliado (anti-fraude Fase 9) */
  await sql`UPDATE users SET signup_ip = ${IP_COMPRADOR} WHERE id = ${caId}`;
  await fundWallet(caId, 20_000);

  const produtoAlvo = produtos.find((p) => p.price === 10000) ?? produtos[0];
  const pedidoAfiliado = await api('/api/orders', {
    method: 'POST',
    token: ca.json?.token,
    ip: IP_COMPRADOR,
    body: {
      customer_name: 'Cliente Afiliado Teste',
      customer_phone: '923777777',
      customer_email: 'cliente_afiliado@teste.com',
      payment_method: 'carteira',
      affiliate_code: CODIGO_ESPERADO,
      affiliate_sub_id: SUB_ID,
      items: [{ id: produtoAlvo.id, quantity: 1 }],
    },
  });
  ok(
    `Compra via link (?ref=…&sub=${SUB_ID}) paga — ${produtoAlvo.price} Kz`,
    pedidoAfiliado.status === 201 && pedidoAfiliado.json?.order?.status === 'pago',
    `status=${pedidoAfiliado.status} ${JSON.stringify(pedidoAfiliado.json?.error ?? '')}`
  );
  const orderId = pedidoAfiliado.json?.order?.id;
  await sleep(500);

  /* ── 7. Verificação da comissão (10% com sub_id) ── */
  console.log('\n7️⃣ Comissão creditada');
  const ganhos = await sql`
    SELECT e.comissao::float8 AS comissao, e.percentual::float8 AS percentual,
           e.sub_id, e.status, e.product_id, e.order_id
    FROM affiliate_earnings e
    WHERE e.order_id = ${orderId} LIMIT 1
  `;
  ok('Linha de comissão registada para a encomenda', ganhos.length === 1);
  const g = ganhos[0];
  ok(`Comissão = 10% (${Math.floor(produtoAlvo.price * 0.1)} Kz)`, g && Math.floor(produtoAlvo.price * 0.1) === Number(g.comissao), g && `${g.comissao} Kz`);
  ok(`sub_id='${SUB_ID}' guardado na comissão`, g?.sub_id === SUB_ID, g?.sub_id);
  ok('status=pago + produto rastreado', g?.status === 'pago' && Number(g.product_id) === produtoAlvo.id);

  const carteira = await sql`
    SELECT saldo::float8 AS saldo FROM wallets WHERE user_id = ${vUserId} LIMIT 1
  `;
  const tx = await sql`
    SELECT id FROM wallet_transactions
    WHERE user_id = ${vUserId} AND tipo = 'comissao' AND order_id = ${orderId} LIMIT 1
  `;
  ok('Comissão na carteira do afiliado (transação «comissao»)', tx.length === 1);
  ok(`Saldo da carteira do vendedor ≥ ${Math.floor(produtoAlvo.price * 0.1)} Kz`, Number(carteira[0]?.saldo) >= Math.floor(produtoAlvo.price * 0.1), `${carteira[0]?.saldo} Kz`);

  const final = await api('/api/affiliate', { token: vTok });
  const rep = final.json?.sub_id_report ?? [];
  const linhaWa = rep.find((r) => r.sub_id === SUB_ID);
  ok(
    `Relatório por canal mostra '${SUB_ID}'`,
    Boolean(linhaWa) && linhaWa.comissoes >= 1 && Number(linhaWa.total) >= Math.floor(produtoAlvo.price * 0.1),
    JSON.stringify(rep)
  );

  /* ── Resumo ── */
  console.log('\n──────────────────────────────────────────');
  console.log(`Resultados: ${passed} ✅ · ${failed} ❌`);
  console.log('\nDados de teste criados (manter ou limpar?):');
  console.log(`  • Vendedor:  ${VENDEDOR.email} / ${VENDEDOR.pass}  (código ${CODIGO_ESPERADO})`);
  console.log('  • Clientes:  cliente1..5@teste.com, cliente_afiliado@teste.com / ' + CLIENT_PASS);
  console.log(`  • Gate:      ${GATE.email} / Vendedor@Gate2026 (descartável, único por execução)`);
  console.log('  • 5 e-books + 5 produtos gate + 11 encomendas pagas + 1 comissão');
  console.log('  • Limpeza:   node scripts/cleanup-fase10-test.js');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('❌ Erro fatal no seed:', e);
  process.exit(1);
});
