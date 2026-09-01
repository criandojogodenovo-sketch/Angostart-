#!/usr/bin/env node
/**
 * AngoStart — Fase 17 codemod: eliminar mistura esmeralda/âmbar → identidade azul/roxo.
 * - Esmeralda → azul (badges/botões/estados), EXCETO ícones de sucesso (Check/ShieldCheck/etc.)
 * - Botões âmbar/laranja → azul sólido ou gradiente azul→roxo
 * - Âmbar em avisos/pendências fica intacto (semântica de alerta)
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'src');

// ————— ficheiros alvo —————
const extraTsFiles = [
  'src/lib/payments-manual.ts',
  'src/lib/kwik.ts',
  'src/lib/products-data.ts',
  'src/app/api/products/route.ts', // apenas o picker de gradientes (UI)
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const allFiles = [
  ...walk(path.join(ROOT, 'components')).filter((f) => f.endsWith('.tsx')),
  ...walk(path.join(ROOT, 'app')).filter((f) => f.endsWith('.tsx')),
  ...extraTsFiles.map((f) => path.join(process.cwd(), f)),
];

// Exclusões: e-mails (lógica de negócio/comunicações) e páginas de autenticação de API
const SKIP = (f) => {
  const norm = f.replaceAll('\\', '/');
  if (norm.includes('/src/lib/email.ts')) return true;
  if (norm.includes('/src/app/api/') && !norm.endsWith('api/products/route.ts')) return true;
  return false;
};

// ————— substituições exatas de BOTÕES âmbar/laranja (avaliadas antes do mapa) —————
const EXACT = [
  // HamburgerMenu — CTA "Adicionar Produto" → gradiente primário
  [
    `? 'bg-amber-500/20 text-amber-300'\n                      : 'bg-amber-500 text-white hover:bg-amber-600'`,
    `? 'bg-white/10 text-blue-300'\n                      : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/25 hover:brightness-110'`,
  ],
  // page.tsx — CTA "Quero vender" → gradiente
  [
    'bg-amber-500 px-8 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-colors hover:bg-amber-600',
    'bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110',
  ],
  // perfil — submit registo: pronto → gradiente / incompleto → azul
  [
    `? 'bg-emerald-500 hover:bg-emerald-600'\n                : 'bg-amber-500 hover:bg-amber-600'`,
    `? 'bg-gradient-to-r from-blue-600 to-purple-600 shadow-lg shadow-blue-600/25 hover:brightness-110'\n                : 'bg-blue-600 hover:bg-blue-700'`,
  ],
  // adicionar-produto — submit principal → gradiente
  [
    'h-12 w-full bg-amber-500 text-base font-semibold text-white hover:bg-amber-600',
    'h-12 w-full bg-gradient-to-r from-blue-600 to-purple-600 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:brightness-110',
  ],
  // ProductCard — badges "Em alta" e "Destaque"
  [
    'border-0 bg-orange-500 text-white shadow-lg',
    'border-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg',
  ],
  ['border-0 bg-amber-400 text-amber-950', 'border-0 bg-blue-600 text-white'],
  // vendedor — toggle "em alta" laranja → azul
  [
    `? 'bg-orange-500 text-white hover:bg-orange-600'\n                            : 'border border-orange-500/40 bg-slate-800/80 text-orange-400 hover:bg-orange-500/10'`,
    `? 'bg-blue-600 text-white hover:bg-blue-700'\n                            : 'border border-blue-500/40 bg-slate-800/80 text-blue-300 hover:bg-blue-500/10'`,
  ],
  // vendedor — botão disponibilidade (texto laranja) → azul
  [
    'h-10 flex-1 bg-white font-semibold text-orange-600 hover:bg-orange-500/10 disabled:opacity-70',
    'h-10 flex-1 bg-white font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-70',
  ],
  // CatalogClient — filtro "Em alta" laranja → azul
  [
    `? 'border-orange-500 bg-orange-500 text-white shadow-md shadow-orange-500/25'\n              : 'border-orange-200 bg-white text-orange-600 hover:border-orange-400 hover:bg-orange-50'`,
    `? 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/25'\n              : 'border-blue-200 bg-white text-blue-600 hover:border-blue-400 hover:bg-blue-50'`,
  ],
  // adicionar-produto — chip de sugestão hover âmbar → azul
  [
    'ring-1 ring-amber-300 transition-colors hover:bg-amber-500 hover:text-white hover:ring-amber-500',
    'ring-1 ring-blue-300 transition-colors hover:bg-blue-500 hover:text-white hover:ring-blue-500',
  ],
];

// ————— mapa esmeralda → azul/roxo (ordem: padrões mais específicos primeiro) —————
const EMERALD_MAP = [
  ['bg-emerald-500/100', 'bg-blue-600'],
  ['bg-emerald-500/15', 'bg-blue-500/15'],
  ['bg-emerald-500/20', 'bg-blue-500/20'],
  ['bg-emerald-500/10', 'bg-blue-500/10'],
  ['bg-emerald-50/60', 'bg-blue-50/60'],
  ['bg-emerald-50/50', 'bg-blue-50/50'],
  ['bg-emerald-50', 'bg-blue-50'],
  ['bg-emerald-100', 'bg-blue-100'],
  ['bg-emerald-200', 'bg-blue-200'],
  ['bg-emerald-300', 'bg-blue-300'],
  ['bg-emerald-400', 'bg-blue-400'],
  ['bg-emerald-500', 'bg-blue-600'],
  ['bg-emerald-600', 'bg-blue-600'],
  ['bg-emerald-700', 'bg-blue-700'],
  ['bg-emerald-950/95', 'bg-slate-900/95'],
  ['hover:bg-emerald-50', 'hover:bg-blue-50'],
  ['hover:bg-emerald-100', 'hover:bg-blue-100'],
  ['hover:bg-emerald-200', 'hover:bg-blue-200'],
  ['hover:bg-emerald-400', 'hover:bg-blue-400'],
  ['hover:bg-emerald-500', 'hover:bg-blue-600'],
  ['hover:bg-emerald-600', 'hover:bg-blue-700'],
  ['hover:bg-emerald-700', 'hover:bg-blue-800'],
  ['text-emerald-50', 'text-blue-50'],
  ['text-emerald-100', 'text-blue-100'],
  ['text-emerald-200', 'text-blue-200'],
  ['text-emerald-300/80', 'text-blue-300/80'],
  ['text-emerald-300', 'text-blue-300'],
  ['text-emerald-400', 'text-blue-300'],
  ['text-emerald-500', 'text-blue-600'],
  ['text-emerald-600', 'text-blue-600'],
  ['text-emerald-700', 'text-blue-700'],
  ['text-emerald-800', 'text-blue-800'],
  ['text-emerald-900', 'text-blue-900'],
  ['hover:text-emerald-300', 'hover:text-blue-300'],
  ['hover:text-emerald-400', 'hover:text-blue-300'],
  ['hover:text-emerald-500', 'hover:text-blue-600'],
  ['hover:text-emerald-600', 'hover:text-blue-700'],
  ['hover:text-emerald-700', 'hover:text-blue-700'],
  ['border-emerald-200', 'border-blue-200'],
  ['border-emerald-300', 'border-blue-300'],
  ['border-emerald-400', 'border-blue-400'],
  ['border-emerald-500/30', 'border-blue-500/30'],
  ['border-emerald-500/40', 'border-blue-500/40'],
  ['border-emerald-500', 'border-blue-500'],
  ['hover:border-emerald-200', 'hover:border-blue-200'],
  ['hover:border-emerald-300', 'hover:border-blue-300'],
  ['hover:border-emerald-400', 'hover:border-blue-400'],
  ['hover:border-emerald-500', 'hover:border-blue-500'],
  ['focus:border-emerald-400', 'focus:border-blue-400'],
  ['focus:border-emerald-500', 'focus:border-blue-500'],
  ['focus:ring-emerald-400', 'focus:ring-blue-400'],
  ['focus:ring-emerald-500', 'focus:ring-blue-500'],
  ['ring-emerald-300', 'ring-blue-300'],
  ['ring-emerald-500', 'ring-blue-500'],
  ['shadow-emerald-500/30', 'shadow-blue-500/30'],
  ['shadow-emerald-500/25', 'shadow-blue-500/25'],
  ['shadow-emerald-900/30', 'shadow-slate-900/30'],
  ['fill-emerald-500', 'fill-blue-500'],
  ['stroke-emerald-500', 'stroke-blue-500'],
  ['divide-emerald-500', 'divide-blue-500'],
  ['from-emerald-400', 'from-blue-500'],
  ['from-emerald-500', 'from-blue-600'],
  ['from-emerald-600/40', 'from-blue-700/40'],
  ['from-emerald-600', 'from-blue-600'],
  ['to-emerald-400', 'to-blue-400'],
  ['to-emerald-600', 'to-purple-600'],
  ['to-emerald-700', 'to-purple-700'],
  ['via-emerald-500', 'via-blue-500'],
  ['decoration-emerald-500', 'decoration-blue-500'],
  ['accent-emerald-500', 'accent-blue-500'],
];

// Ícones de sucesso: linhas com estes componentes mantêm o esmeralda
const SUCCESS_ICON_RE =
  /<(Check|CheckCircle2|CheckCircle|CheckCheck|BadgeCheck|ShieldCheck|MailCheck|CircleCheck)\b/;
const SUCCESS_OPEN_RE =
  /<(Check|CheckCircle2|CheckCircle|CheckCheck|BadgeCheck|ShieldCheck|MailCheck|CircleCheck)$/;

let totalChanges = 0;
const changedFiles = [];

for (const file of allFiles) {
  if (SKIP(file) || !fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = 0;
  let prevOpensSuccessIcon = false;

  const out = lines.map((line) => {
    const isException = SUCCESS_ICON_RE.test(line) || (prevOpensSuccessIcon && /emerald/.test(line));
    prevOpensSuccessIcon = SUCCESS_OPEN_RE.test(line.trimEnd());
    if (isException || !line.includes('emerald')) return line;
    let l = line;
    for (const [from, to] of EMERALD_MAP) {
      if (l.includes(from)) {
        l = l.split(from).join(to);
      }
    }
    if (l !== line) changed++;
    return l;
  });

  let content = out.join('\n');

  // Substituições exatas (botões/badges)
  for (const [from, to] of EXACT) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed++;
    }
  }

  if (changed > 0) {
    fs.writeFileSync(file, content);
    totalChanges += changed;
    changedFiles.push(`${path.relative(process.cwd(), file)} (${changed})`);
  }
}

console.log(`✅ ${totalChanges} alterações em ${changedFiles.length} ficheiros:`);
for (const f of changedFiles) console.log('  •', f);
