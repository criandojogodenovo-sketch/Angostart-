#!/usr/bin/env node
/**
 * Testes da Fase 15 — sistema de palavras-chave (keywords) com anti-spam.
 *
 * Compila o módulo PURO src/lib/keywords.ts (sem BD, sem server-only) e
 * valida: parsing/normalização, limite de 10, duplicados (com/sem acento),
 * palavras genéricas, suspeitas (heurística anti-manipulação), sugestões
 * heurísticas (fallback sem IA) e filtro de sugestões da IA.
 *
 *   node scripts/test-keywords.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, '.keywords-build');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ── compilar o módulo real ── */
function build() {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'keywords.ts'), 'utf8');
  fs.writeFileSync(path.join(BUILD, 'keywords.ts'), src);
  execSync(
    `npx tsc keywords.ts --module commonjs --target es2020 --moduleResolution node ` +
      `--esModuleInterop --skipLibCheck --outDir ${BUILD}`,
    { cwd: BUILD, stdio: 'pipe' }
  );
  return require(path.join(BUILD, 'keywords.js'));
}

const kw = build();

/* ── 1. parseKeywords ── */
console.log('\n1) parseKeywords — normalização e limites');
{
  const r = kw.parseKeywords('design, Ebook,  MARKETING  , design');
  check(
    'aceita string separada por vírgulas',
    JSON.stringify(r.keywords) === JSON.stringify(['design', 'ebook', 'marketing']),
    JSON.stringify(r.keywords)
  );
  check('duplicados exatos removidos (duplicates=1)', r.duplicates === 1);
  check('sem inválidos', r.invalid.length === 0);
}
{
  const r = kw.parseKeywords(['Eletrónica', 'eletronica', 'ELETRÓNICA']);
  check(
    'duplicados com acentos/caixa removidos',
    r.keywords.length === 1 && r.keywords[0] === 'eletrónica',
    JSON.stringify(r.keywords)
  );
}
{
  const r = kw.parseKeywords('a, x, ok-word, ab');
  check('palavra curta (<2) rejeitada', r.invalid.includes('a'));
  check('hífens aceites', r.keywords.includes('ok-word'), JSON.stringify(r.keywords));
}
{
  const long = 'x'.repeat(31);
  const ok30 = 'y'.repeat(30);
  const r = kw.parseKeywords(`${long}, ${ok30}`);
  check('palavra > 30 chars rejeitada', r.invalid.length === 1);
  check(
    'palavra de 30 chars aceite',
    r.keywords.length === 1 && r.keywords[0].length === 30
  );
}
{
  const input = Array.from({ length: 14 }, (_, i) => `kw${i}`);
  const r = kw.parseKeywords(input.join(','));
  check('máx. 10 keywords (truncated=true)', r.keywords.length === 10 && r.truncated === true);
}
{
  const r = kw.parseKeywords('café, computador-novo, português');
  check(
    'acentos portugueses aceites',
    JSON.stringify(r.keywords) === JSON.stringify(['café', 'computador-novo', 'português']),
    JSON.stringify(r.keywords)
  );
}
{
  const r = kw.parseKeywords('com espaço, <script>, cmd;rm, ok1');
  check(
    'espaços/símbolos rejeitados (anti-XSS por formato)',
    r.invalid.length === 3 && JSON.stringify(r.keywords) === JSON.stringify(['ok1']),
    JSON.stringify({ invalid: r.invalid, kw: r.keywords })
  );
}
{
  check('input não-string/não-array → vazio', kw.parseKeywords(42).keywords.length === 0);
  check('input undefined → vazio', kw.parseKeywords(undefined).keywords.length === 0);
}
{
  const r = kw.parseKeywords('-hifen-inicial, ok2');
  check('não começa por hífen', r.invalid.includes('-hifen-inicial'));
}

/* ── 2. isGenericKeyword ── */
console.log('\n2) isGenericKeyword — anti-manipulação de ranking');
{
  check('«barato» é genérica', kw.isGenericKeyword('barato') === true);
  check('«GRÁTIS» (caixa/acentos) é genérica', kw.isGenericKeyword('GRÁTIS') === true);
  check('«promocao» é genérica', kw.isGenericKeyword('promocao') === true);
  check('«design» não é genérica', kw.isGenericKeyword('design') === false);
  check('«canalização» não é genérica', kw.isGenericKeyword('canalização') === false);
}

/* ── 3. isSuspectKeyword ── */
console.log('\n3) isSuspectKeyword — heurística de incoerência');
{
  const name = 'Curso de Design Gráfico no Photoshop';
  const desc = 'Aprende design gráfico do zero: logos, cartazes e templates profissionais.';
  check(
    'keyword coerente não é suspeita',
    kw.isSuspectKeyword('design', name, desc) === false
  );
  check(
    'variação com stem não é suspeita',
    kw.isSuspectKeyword('grafico', name, desc) === false
  );
  check(
    'keyword incoerente («comida») é suspeita',
    kw.isSuspectKeyword('comida', name, desc) === true
  );
  check(
    'keyword genérica nunca é suspeita (só não ranqueia)',
    kw.isSuspectKeyword('barato', name, desc) === false
  );
  check(
    '«eletrónica» ↔ «eletronica» (fold) não é suspeita',
    kw.isSuspectKeyword('eletronicos', 'Vendo eletrónicos usados', 'Telefones e portáteis em bom estado.') === false
  );
}

/* ── 4. suggestKeywordsFromText (fallback sem IA) ── */
console.log('\n4) suggestKeywordsFromText — heurística offline');
{
  const title = 'Curso de Excel para Negócios';
  const desc =
    'Aprende Excel do zero: fórmulas, tabelas dinâmicas e relatórios para o teu negócio. ' +
    'Excel avançado com exemplos práticos.';
  const s = kw.suggestKeywordsFromText(title, desc);
  check('devolve até 10', s.length <= 10 && s.length > 0, JSON.stringify(s));
  check('«excel» no topo (pesa 3+3 no título)', s[0] === 'excel', JSON.stringify(s));
  check('sem stopwords («para», «de»)', !s.includes('para') && !s.includes('de'));
  check('tudo coerente com o texto', s.every((w) => !kw.isSuspectKeyword(w, title, desc)));
}

/* ── 5. filterSuggestedKeywords (sugestões da IA) ── */
console.log('\n5) filterSuggestedKeywords — filtro antes do vendedor');
{
  const name = 'Ebook de Design de Logotipos';
  const desc = 'Guia completo para criar logotipos profissionais no Illustrator.';
  const out = kw.filterSuggestedKeywords(
    ['design', 'comida', 'barato', 'design', 'logotipos', 'futebol', 42, null, 'ilustrador'],
    name,
    desc
  );
  check(
    'mantém coerentes, remove suspeita/genérica/duplicada/não-string',
    JSON.stringify(out) === JSON.stringify(['design', 'logotipos', 'ilustrador']),
    JSON.stringify(out)
  );
  check('respeita máx. 10', kw.filterSuggestedKeywords(Array.from({ length: 20 }, (_, i) => `design${i}`), name, desc).length <= 10);
  check('input inválido → []', JSON.stringify(kw.filterSuggestedKeywords('não-sou-array', name, desc)) === '[]');
}

/* ── 6. constantes exportadas ── */
console.log('\n6) constantes');
{
  check('MAX_KEYWORDS = 10', kw.MAX_KEYWORDS === 10);
  check('MIN_KEYWORD_LEN = 2', kw.MIN_KEYWORD_LEN === 2);
  check('MAX_KEYWORD_LEN = 30', kw.MAX_KEYWORD_LEN === 30);
}

console.log(`\n══ RESULTADO: ${pass} PASS / ${fail} FAIL ${fail === 0 ? '✓' : '✗'} ══`);
if (fail > 0) {
  console.log('Falhas: ' + failures.join(' | '));
  process.exit(1);
}
fs.rmSync(BUILD, { recursive: true, force: true });
