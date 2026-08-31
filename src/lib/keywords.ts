/**
 * AngoStart — Fase 15: palavras-chave (keywords) de produtos com anti-spam.
 *
 * O vendedor pode adicionar até MAX_KEYWORDS palavras-chave ao produto para
 * aparecer na busca (ex.: "design, ebook, marketing"). Regras:
 *
 *  - Cada palavra: entre MIN_KEYWORD_LEN e MAX_KEYWORD_LEN caracteres,
 *    apenas letras (acentos OK — é português!), números e hífens;
 *    duplicados (ignorando acentos/caixa) são removidos.
 *  - Palavras GENÉRICAS ("barato", "melhor", "grátis"…) são aceites mas
 *    NÃO dão prioridade no ranking (isGenericKeyword) — impossibilitam a
 *    manipulação barata de posicionamento.
 *  - Palavras SUSPEITAS não correspondem ao produto (isSuspectKeyword):
 *    heurística local + veredito final da IA no cron diário, que marca
 *    users.keyword_abuse e desconta na nota do perfil.
 *
 * MÓDULO PURO (sem BD, sem server-only): partilhado pelo formulário
 * (client, validação leve imediata), pelas rotas de API (revalidação
 * autoritativa) e pelos testes. O guard de migração vive em
 * `@/lib/keywords-db` (server-only).
 */

export const MAX_KEYWORDS = 10;
export const MIN_KEYWORD_LEN = 2;
export const MAX_KEYWORD_LEN = 30;

/** Letras unicode (acentos PT), números e hífens; não começa por hífen. */
const KEYWORD_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;

/** Remove acentos e põe em minúsculas (comparação tolerante pt-AO). */
export function foldKeyword(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/* ───────────────────────── parsing / validação ───────────────────────── */

export interface ParsedKeywords {
  /** Limpas, validadas, sem duplicados, máx. MAX_KEYWORDS. */
  keywords: string[];
  /** Tokens rejeitados (formato/comprimento) — a API responde 400. */
  invalid: string[];
  /** Duplicados removidos (silencioso — UX amigável). */
  duplicates: number;
  /** true se havia mais do que MAX_KEYWORDS palavras válidas. */
  truncated: boolean;
}

/**
 * Aceita `string` separada por vírgulas OU array de strings; devolve as
 * keywords normalizadas (lowercase) + relatório de rejeitados.
 */
export function parseKeywords(input: unknown): ParsedKeywords {
  const rawTokens: string[] = Array.isArray(input)
    ? input.filter((t): t is string => typeof t === 'string')
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const keywords: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let truncated = false;

  for (const token of rawTokens) {
    const kw = token.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!kw) continue;

    if (
      kw.length < MIN_KEYWORD_LEN ||
      kw.length > MAX_KEYWORD_LEN ||
      !KEYWORD_RE.test(kw)
    ) {
      invalid.push(token.trim().slice(0, 40));
      continue;
    }
    const key = foldKeyword(kw);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    if (keywords.length >= MAX_KEYWORDS) {
      truncated = true;
      continue;
    }
    seen.add(key);
    keywords.push(kw);
  }

  return { keywords, invalid, duplicates, truncated };
}

/* ────────────────────────── anti-spam heurístico ─────────────────────── */

/**
 * Palavras genéricas/de propaganda — aceites na BD mas SEM prioridade no
 * ranking (e nunca sugeridas pela IA). Comparação sem acentos.
 */
const GENERIC_KEYWORDS = new Set(
  [
    'barato', 'baratos', 'barata', 'melhor', 'melhores', 'gratis', 'gratuito',
    'gratuita', 'gratuitos', 'promocao', 'promocoes', 'oferta', 'ofertas',
    'desconto', 'descontos', 'top', 'qualidade', 'novo', 'nova', 'novos',
    'novas', 'rapido', 'rapida', 'bom', 'boa', 'otimo', 'otima', 'preco',
    'vendo', 'venda', 'vendendo', 'angola', 'luanda', 'online', 'entrega',
    'urgente', 'imperdivel', 'aproveite', 'unica', 'unico',
  ].map(foldKeyword)
);

export function isGenericKeyword(keyword: string): boolean {
  return GENERIC_KEYWORDS.has(foldKeyword(keyword));
}

/**
 * Heurística local de suspeição: a keyword NÃO tem qualquer relação com o
 * nome/descrição do produto. Relação = fold(keyword) aparece no texto, OU
 * partilha um prefixo "stem" (≥4 caracteres) com alguma palavra do texto,
 * OU tem similaridade de bigramas (Dice ≥ 0.45) com alguma palavra —
 * apanha variações ortográficas reais ("ilustrador" ↔ "Illustrator").
 * Genéricas NÃO são "suspeitas" — só não ranqueiam.
 * (O veredito final é da IA no cron diário — esta heurística filtra na
 * hora: sugestões irrelevantes nunca chegam ao vendedor.)
 */
export function isSuspectKeyword(
  keyword: string,
  productName: string,
  productDescription: string
): boolean {
  const kw = foldKeyword(keyword);
  if (!kw || isGenericKeyword(kw)) return false;

  const haystack = foldKeyword(`${productName} ${productDescription}`);
  if (haystack.includes(kw)) return false;

  const stem = kw.length >= 4 ? kw.slice(0, 4) : kw;
  if (stem.length >= 4 && haystack.includes(stem)) return false;

  const words = haystack.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return !words.some((w) => diceSimilarity(kw, w) >= 0.45);
}

/** Conjunto de bigramas de uma string (para similaridade Dice). */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice (0-1) entre os bigramas de duas strings. */
function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let shared = 0;
  for (const g of ba) if (bb.has(g)) shared++;
  return (2 * shared) / (ba.size + bb.size);
}

/* ─────────────────── sugestões heurísticas (fallback sem IA) ─────────── */

/** Stopwords pt comuns (nunca fazem sentido como keyword de busca). */
const STOPWORDS = new Set(
  [
    'para', 'com', 'sem', 'que', 'dos', 'das', 'por', 'uma', 'como', 'mais',
    'seus', 'suas', 'pelo', 'pela', 'ate', 'até', 'onde', 'aqui', 'todos',
    'todas', 'voce', 'você', 'teu', 'tua', 'teus', 'tuas', 'seu', 'sua',
    'este', 'esta', 'isso', 'esse', 'essa', 'elas', 'ele', 'eles', 'nos',
    'nós', 'the', 'and', 'de', 'da', 'do', 'em', 'no', 'na', 'os', 'as',
    'um', 'uns', 'ao', 'aos', 'e', 'o', 'a', 'ou', 'se', 'foi', 'ser',
    'muito', 'muita', 'pode', 'podem', 'vai', 'vao', 'faz', 'fazer',
  ].map(foldKeyword)
);

/**
 * Extrai até `max` keywords diretamente do título/descrição — fallback
 * determinístico quando a IA está indisponível (o endpoint de sugestões
 * NUNCA falha por falta de IA). Palavras do título pesam ×3.
 */
export function suggestKeywordsFromText(
  title: string,
  description: string,
  max = MAX_KEYWORDS
): string[] {
  const titleText = foldKeyword(title);
  const freq = new Map<string, number>();

  const addTokens = (text: string, weight: number) => {
    for (const raw of text.split(/[^a-z0-9à-ú]+/i)) {
      const w = foldKeyword(raw);
      if (
        w.length < MIN_KEYWORD_LEN ||
        w.length > MAX_KEYWORD_LEN ||
        !KEYWORD_RE.test(w) ||
        STOPWORDS.has(w) ||
        isGenericKeyword(w) ||
        /^\d+$/.test(w) // só números não ajudam a busca
      ) {
        continue;
      }
      freq.set(w, (freq.get(w) ?? 0) + weight);
    }
  };

  addTokens(titleText, 3);
  addTokens(foldKeyword(description), 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * Filtra/valida keywords SUGERIDAS (pela IA) para um produto: rejeita não
 * strings, formatos inválidos, duplicados, genéricas e suspeitas (que não
 * correspondem ao produto) — antes de chegar ao vendedor.
 */
export function filterSuggestedKeywords(
  suggestions: unknown,
  productName: string,
  productDescription: string,
  max = MAX_KEYWORDS
): string[] {
  if (!Array.isArray(suggestions)) return [];
  const parsed = parseKeywords(suggestions);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const kw of parsed.keywords) {
    if (out.length >= max) break;
    if (isGenericKeyword(kw)) continue;
    if (isSuspectKeyword(kw, productName, productDescription)) continue;
    const key = foldKeyword(kw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}

