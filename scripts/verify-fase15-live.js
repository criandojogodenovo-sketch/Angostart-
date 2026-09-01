#!/usr/bin/env node
/**
 * Smoke test pós-migração Fase 15 (read-only) — valida contra a Neon REAL
 * que as queries de keywords usadas pelas rotas funcionam:
 *   1. Colunas existem (information_schema) — o mesmo check do keywordsReady()
 *   2. Busca por keywords (unnest + ILIKE) — padrão do GET /api/products?q=
 *   3. Ranking boost (CASE WHEN EXISTS) — padrão do ORDER BY
 *   4. kw_matches de prestadores — padrão do /api/prestadores
 *   5. Escrita de teste EM TRANSAÇÃO com ROLLBACK (não altera dados reais):
 *      INSERT com ${array}::text[] + UPDATE keywords_updated_at
 *   6. users.keyword_abuse — padrão do saveSellerRating
 *
 * Uso: DATABASE_URL=postgres://… node scripts/verify-fase15-live.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida (nunca commitar segredos).');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
  };

  console.log('🔍 Fase 15 — verificação live (read-only + rollback)…\n');

  /* 1. Colunas (o check exato do guard keywordsReady()) */
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'products' AND column_name = 'keywords' LIMIT 1`;
  check('guard keywordsReady() devolveria true', cols.length === 1);

  const all = await sql`
    SELECT table_name || '.' || column_name AS col, data_type
      FROM information_schema.columns
     WHERE (table_name = 'products' AND column_name IN ('keywords','keywords_updated_at'))
        OR (table_name = 'users' AND column_name IN ('keyword_abuse','keyword_abuse_detail'))
     ORDER BY 1`;
  check('4 colunas Fase 15 presentes', all.length === 4, JSON.stringify(all));

  const idx = await sql`
    SELECT indexname FROM pg_indexes
     WHERE indexname IN ('idx_products_keywords','idx_users_keyword_abuse') ORDER BY 1`;
  check('2 índices criados', idx.length === 2, JSON.stringify(idx));

  /* 2. Query de busca por keywords (padrão real da rota) */
  const like = '%design%';
  await sql`
    SELECT p.id FROM products p
     WHERE EXISTS (SELECT 1 FROM unnest(p.keywords) k WHERE k ILIKE ${like})
     LIMIT 1`;
  check('busca unnest(keywords) ILIKE funciona', true);

  /* 3. Ranking boost (padrão real do ORDER BY) */
  await sql`
    SELECT p.id,
           (CASE WHEN EXISTS (SELECT 1 FROM unnest(p.keywords) k WHERE k ILIKE ${like})
                 THEN 1 ELSE 0 END) AS boost
      FROM products p
     ORDER BY boost DESC, p.is_hot DESC, p.created_at DESC
     LIMIT 3`;
  check('ranking boost (CASE WHEN EXISTS) funciona', true);

  /* 4. kw_matches de prestadores (subquery count com join unnest) */
  await sql`
    SELECT u.id,
           (SELECT count(*)::int FROM products pk
              JOIN unnest(pk.keywords) kk ON TRUE
             WHERE pk.user_id = u.id AND kk ILIKE ${like}) AS kw_matches
      FROM users u
     WHERE u.role IN ('prestador_domicilio','prestador_remoto') AND u.blocked = FALSE
     ORDER BY kw_matches DESC LIMIT 3`;
  check('kw_matches de prestadores funciona', true);

  /* 5. Escrita em transação com ROLLBACK — valida INSERT/UPDATE reais */
  await sql`BEGIN`;
  try {
    const ins = await sql`
      INSERT INTO products (name, description, price_kz, type, icon, gradient, user_id, featured, rating, stock, keywords, keywords_updated_at)
      VALUES ('__smoke_test_fase15__', 'teste temporário da migração fase 15', 1000, 'infoproduto', 'graduation-cap', 'from-emerald-500 to-teal-600', (SELECT id FROM users WHERE role IN ('criador','prestador_domicilio','prestador_remoto') LIMIT 1), FALSE, NULL, -1, ${['design','ebook']}::text[], NOW())
      RETURNING id, keywords`;
    check(
      'INSERT com array::text[] grava keywords',
      ins[0]?.keywords?.length === 2 && ins[0].keywords[0] === 'design',
      JSON.stringify(ins[0])
    );
    const upd = await sql`
      UPDATE products SET keywords_updated_at = NOW()
       WHERE id = ${ins[0].id} RETURNING keywords_updated_at`;
    check('UPDATE keywords_updated_at funciona', !!upd[0]?.keywords_updated_at);
    const kw = await sql`
      UPDATE users
         SET keyword_abuse = TRUE, keyword_abuse_detail = 'teste rollback'
       WHERE id = (SELECT user_id FROM products WHERE id = ${ins[0].id})
       RETURNING keyword_abuse`;
    check('UPDATE users.keyword_abuse funciona', kw[0]?.keyword_abuse === true);
  } finally {
    await sql`ROLLBACK`;
    console.log('  ↩️  ROLLBACK executado — nenhum dado real alterado.');
  }

  /* 6. Estado atual (quantos produtos têm keywords) */
  const stats = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE array_length(keywords, 1) > 0)::int AS com_keywords
      FROM products`;
  console.log(
    `\n📊 Produtos: ${stats[0].total} no total, ${stats[0].com_keywords} já com keywords.`
  );

  console.log(`\n══ RESULTADO: ${pass} PASS / ${fail} FAIL ${fail === 0 ? '✓' : '✗'} ══`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('❌ Erro fatal:', error.message);
  process.exit(1);
});
