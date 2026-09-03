import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import { sanitizeMultiline, sanitizeText, clientKey, rateLimit } from '@/lib/security';
import { aiChatJSON, aiAvailable } from '@/lib/ai/chat';
import { containsPromptInjection } from '@/lib/ai/security';
import {
  suggestKeywordsFromText,
  filterSuggestedKeywords,
  MAX_KEYWORDS,
} from '@/lib/keywords';

export const dynamic = 'force-dynamic';
/* Hotfix 502: mesma região da rota de chat (ver /api/ai/chat/route.ts). */
export const preferredRegion = 'iad1';

/**
 * POST /api/ai/suggest-keywords — Fase 15b: sugestão automática de
 * palavras-chave no formulário de produto, com a IA da plataforma
 * (B.AI/GLM-5.3-Flash — `B_AI_MODEL_CHAT` — com fallback multi-provider).
 *
 * Entrada:  { title, description }  (rascunho atual do vendedor)
 * Saída:    { ok: true, keywords: string[], source: 'ai' | 'heuristica',
 *             provider?, model? }
 *
 * - 🔒 Apenas vendedores autenticados; rate limit 3 sugestões/minuto por
 *   utilizador (o chat de suporte usa 10/min — aqui cada pedido custa uma
 *   chamada IA, por isso é mais apertado).
 * - Sanitização de inputs + filtro anti-injeção (bio/produtos são input
 *   do utilizador — o mesmo padrão de /api/ai/review-seller).
 * - As sugestões da IA passam pelo filtro anti-abuso (filterSuggestedKeywords):
 *   formato, duplicados, genéricas e keywords que NÃO correspondem ao
 *   produto (ex.: "comida" num ebook de design) são removidas antes de
 *   chegar ao vendedor.
 * - FALLBACK SEM IA: se a IA falhar (sem chave, 429, timeout), devolve
 *   sugestões heurísticas extraídas do próprio título/descrição
 *   (source: 'heuristica') — o formulário NUNCA fica bloqueado e a
 *   funcionalidade existe mesmo sem nenhum provider configurado.
 * - A chave do provider vive só no servidor (lib/ai) — nunca no cliente.
 */

const SUGGEST_SYSTEM = `Sugeres palavras-chave (keywords) de busca para produtos e serviços da AngoStart, um marketplace angolano.

Regras:
- Máximo ${MAX_KEYWORDS} keywords, em português de Angola, minúsculas, sem acentos desnecessários.
- Cada keyword: entre 2 e 30 caracteres; apenas letras, números e hífens (nada de espaços ou símbolos).
- Apenas termos que um COMPRADOR escreveria na busca e que correspondem ao produto (ex.: para um ebook de design: "design", "logotipo", "photoshop").
- NUNCA sugiras termos genéricos de propaganda ("barato", "grátis", "promoção"), marcas de que o produto não trata, nem termos sem relação com o título/descrição.
- NÃO repitas variações óbvias da mesma palavra (escolhe a mais procurada).

Responde APENAS com JSON válido:
{"keywords": ["<keyword 1>", "<keyword 2>", …]}`;

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão necessária. Entra novamente.' },
      { status: 401 }
    );
  }
  if (!isSellerRole(user.role)) {
    return NextResponse.json(
      { error: 'Apenas vendedores podem pedir sugestões de keywords.' },
      { status: 403 }
    );
  }

  /* 3 sugestões/minuto por utilizador (custa 1 chamada IA cada). */
  if (!rateLimit(clientKey(request, `suggest-kw-u${user.id}`), 3, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas sugestões seguidas — aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: { title?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const title = sanitizeText(body.title, 120);
  const description = sanitizeMultiline(body.description, 2000);

  if (title.trim().length < 3) {
    return NextResponse.json(
      { error: 'Escreve primeiro o nome do produto (pelo menos 3 letras).' },
      { status: 400 }
    );
  }
  if (description.trim().length < 10) {
    return NextResponse.json(
      { error: 'Escreve primeiro a descrição (pelo menos 10 caracteres).' },
      { status: 400 }
    );
  }

  /* ── Fallback heurístico — sempre disponível (sem IA, sem rede). ── */
  const heuristic = suggestKeywordsFromText(title, description);

  if (!aiAvailable() || containsPromptInjection(`${title}\n${description}`)) {
    return NextResponse.json({
      ok: true,
      keywords: heuristic,
      source: 'heuristica',
    });
  }

  /* ── IA multi-provider (B.AI primeiro, fallback automático). ── */
  const ai = await aiChatJSON<{ keywords?: unknown }>(
    SUGGEST_SYSTEM,
    JSON.stringify({ titulo: title, descricao: description }),
    { maxTokens: 200, temperature: 0.3 }
  );
  const out = ai?.data;

  if (!out) {
    /* IA falhou (429/timeout/indisponível) — heurística em vez de 5xx:
       o vendedor continua desbloqueado (requisito do formulário). */
    return NextResponse.json({
      ok: true,
      keywords: heuristic,
      source: 'heuristica',
    });
  }

  const filtered = filterSuggestedKeywords(out.keywords, title, description);

  /* IA respondeu mas tudo foi filtrado → mostra as heurísticas. */
  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true,
      keywords: heuristic,
      source: heuristic.length > 0 ? 'heuristica' : 'ai',
      provider: ai!.provider,
      model: ai!.model,
    });
  }

  /* Top-up: se a IA deu poucas, completa com heurísticas úteis. */
  const merged = [...filtered];
  for (const kw of heuristic) {
    if (merged.length >= MAX_KEYWORDS) break;
    if (!merged.includes(kw)) merged.push(kw);
  }

  return NextResponse.json({
    ok: true,
    keywords: merged.slice(0, MAX_KEYWORDS),
    source: 'ai',
    provider: ai!.provider,
    model: ai!.model,
  });
}
