import 'server-only';

/**
 * AngoStart — Fase 15: guard de migração das keywords (server-only).
 *
 * A migração Fase 15 (`scripts/migrate-fase15.js`) adiciona
 * `products.keywords TEXT[]` / `products.keywords_updated_at` e
 * `users.keyword_abuse` / `users.keyword_abuse_detail`. Como o deploy do
 * código pode chegar à Vercel ANTES de a migração correr na Neon, todas
 * as queries condicionam as colunas novas a `keywordsReady()`:
 *
 *  - false → os SQLs omitem as colunas e a plataforma comporta-se
 *    exatamente como na Fase 14 (catálogo, busca e publicação normais —
 *    keywords simplesmente ignoradas).
 *  - true (cacheado no processo) → SQLs com keywords ativados.
 *
 * O `false` por ERRO (BD em baixo) não é cacheado — tenta de novo no
 * próximo pedido. Assim o catálogo NUNCA fica em branco por culpa de uma
 * coluna em falta (sem isto, o GET /api/products cairia no catch geral e
 * devolveria lista vazia até à migração correr).
 */

import { sql } from '@/lib/db';

const globalForKeywords = globalThis as unknown as {
  angostartKeywordsReady?: boolean;
};

export async function keywordsReady(): Promise<boolean> {
  if (globalForKeywords.angostartKeywordsReady !== undefined) {
    return globalForKeywords.angostartKeywordsReady;
  }
  try {
    const rows = (await sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'keywords'
       LIMIT 1
    `) as unknown as unknown[];
    if (rows.length > 0) {
      globalForKeywords.angostartKeywordsReady = true;
    }
    return rows.length > 0;
  } catch (error) {
    console.error(
      '[lib/keywords-db] keywordsReady() não conseguiu verificar (BD em baixo?):',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/** Marca a flag manualmente (usado pelos testes). */
export function setKeywordsReadyForTests(value: boolean): void {
  globalForKeywords.angostartKeywordsReady = value;
}

/**
 * Coluna in falta confirmada (erro 42703 apanhar a meio) — cacheia `false`
 * de forma DEFINITIVA no processo (a migração não aparece sozinha; só um
 * redeploy/restart volta a tentar). Evita repetir queries que falham.
 */
export function markKeywordsUnavailable(): void {
  globalForKeywords.angostartKeywordsReady = false;
}

/**
 * Erro 42703 = coluna inexistente. Rede de segurança: se por qualquer
 * motivo um SQL com keywords escapar ao guard (ex.: nova instância a meio
 * com cache ainda fria), o chamador deteta, marca o guard como falso e
 * repete a query sem keywords.
 */
export function isUndefinedColumnError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (code === '42703') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('does not exist') && msg.includes('column');
}
