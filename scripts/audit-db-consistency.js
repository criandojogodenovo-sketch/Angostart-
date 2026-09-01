/**
 * AngoStart — Auditoria de consistência da BD (Fase 5) — SÓ LEITURA.
 * Uso: DATABASE_URL='postgresql://...' node scripts/audit-db-consistency.js
 */
const { neon } = require('@neondatabase/serverless');

try {
  require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n').forEach((l) => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
} catch {}
const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);

let pass = 0, fail = 0, warn = 0;
const issues = [];
function check(name, cond, detail = '', severity = 'FAIL') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else if (severity === 'WARN') { warn++; console.log(`  ⚠️  ${name} — ${detail}`); issues.push(`[WARN] ${name}: ${detail}`); }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`); issues.push(`${name}: ${detail}`); }
}

async function main() {
  console.log('🗄️  AngoStart — Auditoria de consistência da BD\n');

  /* 1. Dados órfãos */
  console.log('👤 1. Dados órfãos');
  let r = await sql`SELECT COUNT(*)::int AS n FROM products p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL`;
  check('produtos sem vendedor', r[0].n === 0, `${r[0].n} produtos órfãos`);
  r = await sql`SELECT COUNT(*)::int AS n FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.user_id IS NOT NULL AND u.id IS NULL`;
  check('encomendas sem cliente (user_id não-nulo inválido)', r[0].n === 0, `${r[0].n} órfãs`);
  r = await sql`SELECT COUNT(*)::int AS n FROM stores s LEFT JOIN users u ON u.id = s.owner_id WHERE u.id IS NULL`;
  check('lojas sem dono', r[0].n === 0, `${r[0].n} órfãs`);
  r = await sql`SELECT COUNT(*)::int AS n FROM reviews rv LEFT JOIN users u ON u.id = rv.user_id WHERE u.id IS NULL`;
  check('avaliações sem utilizador', r[0].n === 0, `${r[0].n} órfãs`);
  r = await sql`SELECT COUNT(*)::int AS n FROM wallet_transactions t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL`;
  check('transações de carteira sem utilizador', r[0].n === 0, `${r[0].n} órfãs`);
  r = await sql`SELECT COUNT(*)::int AS n FROM air_orders a LEFT JOIN users u ON u.id = a.user_id WHERE u.id IS NULL`;
  check('air_orders sem publicador', r[0].n === 0, `${r[0].n} órfãs`);

  /* 2. Integridade lógica */
  console.log('\n🔗 2. Integridade lógica');
  r = await sql`SELECT COUNT(*)::int AS n FROM air_orders WHERE provider_id IS NOT NULL AND provider_id = user_id`;
  check('ninguém aceitou o próprio air order', r[0].n === 0, `${r[0].n} violações`);
  r = await sql`SELECT COUNT(*)::int AS n FROM air_orders WHERE status <> 'aberto' AND provider_id IS NULL`;
  check('air orders aceite/concluído têm provider', r[0].n === 0, `${r[0].n} com estado avançado sem provider`);
  r = await sql`SELECT COUNT(*)::int AS n FROM contact_requests WHERE client_id = provider_id`;
  check('sem auto-contactos', r[0].n === 0, `${r[0].n} violações`);
  r = await sql`SELECT COUNT(*)::int AS n FROM reviews WHERE rating < 1 OR rating > 5`;
  check('ratings no intervalo 1-5', r[0].n === 0, `${r[0].n} fora do intervalo`);
  r = await sql`SELECT COUNT(*)::int AS n FROM products WHERE price_kz <= 0`;
  check('produtos com preço > 0', r[0].n === 0, `${r[0].n} com preço inválido`);
  r = await sql`SELECT COUNT(*)::int AS n FROM orders WHERE total_kz < 0`;
  check('encomendas com total ≥ 0', r[0].n === 0, `${r[0].n} negativas`);

  /* 3. Escrow / carteiras */
  console.log('\n💰 3. Escrow & carteiras');
  r = await sql`SELECT COUNT(*)::int AS n FROM wallets WHERE saldo < 0`;
  check('saldos de carteira não-negativos', r[0].n === 0, `${r[0].n} saldos negativos`);
  // encomendas pagas com valores inconsistentes entre orders.total_kz e soma dos items
  const mismatch = await sql`
    SELECT COUNT(*)::int AS n FROM orders
    WHERE status IN ('pago', 'entregue', 'concluido')
      AND ABS(total_kz::float8 - COALESCE((
        SELECT SUM((i->>'price_kz')::float8 * (i->>'quantity')::float8)
        FROM jsonb_array_elements(items) i
      ), 0)) > 0.01`;
  check('encomendas pagas: total = Σ(items × qtd)', mismatch[0].n === 0, `${mismatch[0].n} com total inconsistente`);
  // carteiras vs extrato (conservador: só sinaliza diferenças grandes)
  const wsum = await sql`
    SELECT w.user_id, w.saldo::float8 AS bal,
           COALESCE((SELECT SUM(CASE WHEN t.tipo='deposito' THEN t.valor::float8 WHEN t.tipo='saque' THEN -t.valor::float8 ELSE 0 END)
                     FROM wallet_transactions t WHERE t.user_id = w.user_id AND t.status='concluido'), 0) AS fluxo
    FROM wallets w`;
  const wbad = wsum.filter((x) => Math.abs(x.bal - x.fluxo) > 1);
  check('carteiras: saldo ≈ fluxo concluído', wbad.length === 0,
    wbad.length ? `${wbad.length} carteiras divergentes (ex.: user ${wbad[0]?.user_id}, bal=${wbad[0]?.bal}, fluxo=${wbad[0]?.fluxo}) — pode incluir bónus/ajustes manuais` : '', 'WARN');

  /* 4. Comissões */
  console.log('\n📊 4. Comissões');
  r = await sql`SELECT COUNT(*)::int AS n FROM commission_rates WHERE percent < 0 OR percent > 100`;
  check('taxas de comissão 0-100%', r[0].n === 0, `${r[0].n} fora do intervalo`);
  r = await sql`SELECT COUNT(*)::int AS n FROM seller_commission_overrides WHERE percent < 0 OR percent > 100`;
  check('overrides de comissão 0-100%', r[0].n === 0, `${r[0].n} fora do intervalo`);
  r = await sql`SELECT COUNT(*)::int AS n FROM affiliate_earnings WHERE comissao < 0`;
  check('ganhos de afiliado não-negativos', r[0].n === 0, `${r[0].n} negativos`);

  /* 5. Afiliados — auto-indicação */
  console.log('\n🎯 5. Afiliados');
  const selfRef = await sql`
    SELECT COUNT(*)::int AS n FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN affiliates a ON a.codigo_afiliado = o.affiliate_code
    WHERE o.affiliate_code IS NOT NULL AND a.user_id = u.id`;
  check('sem auto-indicação de afiliado', selfRef[0].n === 0, `${selfRef[0].n} encomendas com auto-indicação`);
  const aefraud = await sql`
    SELECT COUNT(*)::int AS n FROM affiliate_earnings e
    JOIN orders o ON o.id = e.order_id
    JOIN affiliates a ON a.id = e.affiliate_id
    WHERE o.user_id = a.user_id`;
  check('sem earnings de afiliado em auto-compra', aefraud[0].n === 0, `${aefraud[0].n} casos`);

  /* 6. Utilizadores */
  console.log('\n👥 6. Utilizadores');
  r = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role NOT IN ('cliente','criador','prestador_domicilio','prestador_remoto','admin','admin_limitado')`;
  check('roles válidos', r[0].n === 0, `${r[0].n} inválidos`);
  r = await sql`SELECT COUNT(*)::int AS n FROM users WHERE email !~* '^[^@]+@[^@]+\\.[^@]+$'`;
  check('emails bem formados', r[0].n === 0, `${r[0].n} inválidos`);
  const dupEmail = await sql`SELECT email, COUNT(*)::int AS n FROM users GROUP BY email HAVING COUNT(*) > 1`;
  check('emails únicos', dupEmail.length === 0, dupEmail.map((x) => x.email).join(', '));

  /* 7. Estado geral */
  console.log('\n📈 7. Estado geral');
  const counts = await sql`
    SELECT (SELECT COUNT(*)::int FROM users) AS users,
           (SELECT COUNT(*)::int FROM products) AS products,
           (SELECT COUNT(*)::int FROM orders) AS orders,
           (SELECT COUNT(*)::int FROM orders WHERE status='aguardando_validacao') AS pendentes_ai,
           (SELECT COUNT(*)::int FROM air_orders) AS air_orders,
           (SELECT COUNT(*)::int FROM business_profiles) AS business,
           (SELECT COUNT(*)::int FROM orders WHERE ai_verification IS NOT NULL) AS com_auditoria_ia`;
  const c = counts[0];
  console.log(`  users=${c.users} produtos=${c.products} encomendas=${c.orders} (por validar IA: ${c.pendentes_ai}, com auditoria IA: ${c.com_auditoria_ia}) air_orders=${c.air_orders} estabelecimentos=${c.business}`);

  console.log(`\n══════════════════════════════`);
  console.log(`RESULTADO: ${pass} OK | ${warn} avisos | ${fail} FALHAS`);
  if (issues.length) issues.forEach((i) => console.log('  • ' + i));
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌ Erro fatal:', e.message); process.exit(1); });
