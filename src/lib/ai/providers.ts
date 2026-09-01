import 'server-only';

/**
 * AngoStart — Fase 14b: IA multi-provider com fallback chain.
 *
 * MISSÃO: a IA da plataforma NUNCA fica offline por rate limit ou modelo
 * indisponível de um único fornecedor. Custo zero (planos gratuitos).
 *
 * CADEIA DE FALLBACK (ordem de prioridade, definida pelo CTO — Fase 19b):
 *   0. bai          — B.AI (gateway unificado estilo Z.ai): UMA chave, OpenAI-
 *                     compat, modelos flagship gratuitos (glm-5.3-flash,
 *                     deepseek-v4-flash; visão: deepseek-v4-flash-vision-exp).
 *                     PRINCIPAL — timeout curto 15s (redes móveis 4G).
 *   1. openrouter  — 18 modelos :free (50 req/dia; 1000/dia com ≥10 créditos
 *                    na conta; 20 req/min). Texto E visão (:free com imagem).
 *                    ÚNICO fallback — timeout agressivo 8s.
 *   Se AMBOS falharem, a rota devolve mensagem amigável ao utilizador
 *   (tempo máximo de espera ≈ 23s — cabe nos limites da Vercel e do 4G).
 *
 * RESERVA (fora da cadeia — `inChain: false`, reativáveis por env/commit se
 * o CTO decidir): gemini, groq, cerebras, sambanova. Continuam no status de
 * diagnóstico mas NUNCA são chamados em produção — evitam esperas de 30s+
 * em cascata em redes lentas.
 *
 * O sistema funciona com QUALQUER subconjunto de chaves (mínimo 1; com 2+
 * já há redundância real — recomendado: B_AI_API_KEY + 1 fallback).
 *
 * ⚠️ SERVER-ONLY: nenhuma chave de provider chega ao cliente — este módulo
 * só é importado por rotas de API e crons.
 *
 * ⚠️ URLS: TODAS as chamadas usam `fetch` direto ao endpoint OpenAI-compat
 * `/chat/completions` de cada provider — SEM SDK intermediário. Isto elimina
 * (por construção) o bug do groq-sdk que duplicava o prefixo
 * `/openai/v1/openai/v1/...` quando se passava baseURL com o caminho pronto.
 *
 * Modelos: o catálogo free muda com frequência (ex.: `openai/gpt-oss-20b:free`
 * saiu do catálogo OpenRouter; a Cerebras podou o free tier em 2026) — TODOS
 * os modelos são overridáveis via env sem novo deploy de código:
 *   OPENROUTER_MODEL_TEXT / OPENROUTER_MODEL_VISION / GEMINI_MODEL /
 *   GROQ_MODEL_CHAT / GROQ_MODEL_VISION / CEREBRAS_MODEL / SAMBANOVA_MODEL /
 *   B_AI_MODEL_CHAT / B_AI_MODEL_VISION
 *
 * Licenças (uso comercial): modelos open-weight — verificar os termos no
 * Hugging Face antes de uso comercial pesado (Llama Community License,
 * Gemma Terms of Use, Qwen/GLM Apache-2.0, etc.). Os endpoints geridos
 * cobrem o uso normal da plataforma.
 */

export type ModelType = 'text' | 'vision';

export type AiRole = 'system' | 'user' | 'assistant';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: AiRole;
  content: string | AiContentPart[];
}

export interface ProviderConfig {
  /** Identificador curto (logs/auditoria). */
  name: string;
  label: string;
  /** Base OpenAI-compat SEM barra final (ex.: https://api.groq.com/openai/v1). */
  baseURL: string;
  /** Nome da env var com a chave (nunca a chave em si). */
  apiKeyEnv: string;
  textModel: () => string;
  /** `null` = provider não suporta visão (é saltado na cadeia de visão). */
  visionModel: () => string | null;
  /** Enviar `response_format: json_object`? (extractJSON cobre os outros.) */
  jsonMode: boolean;
  extraHeaders: () => Record<string, string>;
  timeoutMs: number;
  /** Fase 19b: `false` = reserva — fora da cadeia de fallback (não é chamado). */
  inChain?: boolean;
}

/** Lê env var numérico no momento da chamada (tuning de timeout sem deploy). */
function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Lê env var no MOMENTO da chamada (permite override/testes sem reload). */
function envOr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

/**
 * Registry na ORDEM EXATA da cadeia de fallback. Mudar a ordem aqui muda a
 * prioridade global — nada mais precisa ser editado.
 */
export const PROVIDERS: ProviderConfig[] = [
  {
    name: 'bai',
    label: 'B.AI (principal)',
    baseURL: 'https://api.b.ai/v1',
    apiKeyEnv: 'B_AI_API_KEY',
    // Defaults = modelos gratuitos do catálogo B.AI indicados pelo CTO
    // (glm-5.3-flash para texto; deepseek-v4-flash-vision-exp para visão).
    // Endpoint verificado por curl (OpenAI-compat, 401 sem chave). IDs
    // overridáveis — validar com a chave real em produção; se um ID estiver
    // errado, a cadeia salta para o provider seguinte.
    textModel: () => envOr('B_AI_MODEL_CHAT', 'glm-5.3-flash'),
    visionModel: () => envOr('B_AI_MODEL_VISION', 'deepseek-v4-flash-vision-exp'),
    jsonMode: true,
    extraHeaders: () => ({}),
    // Fase 19b: timeout curto — 4G não deve esperar 30s pelo principal.
    timeoutMs: envNum('AI_TIMEOUT_BAI_MS', 15_000),
    inChain: true,
  },
  {
    name: 'openrouter',
    label: 'OpenRouter (:free)',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    // ⚠️ `openai/gpt-oss-20b:free` SAIU do catálogo free (verificado por curl
    // em 2026-08). Defaults = modelos free reais no catálogo atual:
    //  - texto : z-ai/glm-5.2:free   (text→text, ctx 256k)
    //  - visão : google/gemma-4-31b-it:free (text+image→text, ctx 262k)
    textModel: () => envOr('OPENROUTER_MODEL_TEXT', 'z-ai/glm-5.2:free'),
    visionModel: () =>
      envOr('OPENROUTER_MODEL_VISION', 'google/gemma-4-31b-it:free'),
    jsonMode: true,
    extraHeaders: () => ({
      // Headers de atribuição recomendados pela OpenRouter (identificam a
      // plataforma no dashboard e podem aumentar limites de app).
      'HTTP-Referer':
        process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://angostart.ao',
      'X-Title': 'AngoStart',
    }),
    // Fase 19b: único fallback — agressivo 8s (pior caso total ≈ 23s).
    timeoutMs: envNum('AI_TIMEOUT_OPENROUTER_MS', 8_000),
    inChain: true,
  },
  {
    name: 'gemini',
    label: 'Google Gemini (OpenAI-compat)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    // gemini-2.5-flash é multimodal (texto + imagem) — serve os dois tipos.
    textModel: () => envOr('GEMINI_MODEL', 'gemini-2.5-flash'),
    visionModel: () => envOr('GEMINI_MODEL', 'gemini-2.5-flash'),
    jsonMode: true,
    extraHeaders: () => ({}),
    timeoutMs: 30_000,
    inChain: false, // reserva — fora da cadeia (Fase 19b)
  },
  {
    name: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    textModel: () => envOr('GROQ_MODEL_CHAT', 'llama-3.1-8b-instant'),
    // Visão: llama-4-scout é o VLM da Groq (gpt-oss-120b é só texto).
    visionModel: () =>
      envOr('GROQ_MODEL_VISION', 'meta-llama/llama-4-scout-17b-16e-instruct'),
    jsonMode: true,
    extraHeaders: () => ({}),
    timeoutMs: 25_000,
    inChain: false, // reserva — fora da cadeia (Fase 19b)
  },
  {
    name: 'cerebras',
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    // ID no catálogo Cerebras é `llama-3.3-70b` (o formato
    // `meta-llama/llama-3.3-70b-instruct` é da SambaNova). Overridável.
    textModel: () => envOr('CEREBRAS_MODEL', 'llama-3.3-70b'),
    visionModel: () => null, // só texto
    jsonMode: true,
    extraHeaders: () => ({}),
    timeoutMs: 25_000,
    inChain: false, // reserva — fora da cadeia (Fase 19b)
  },
  {
    name: 'sambanova',
    label: 'SambaNova',
    baseURL: 'https://api.sambanova.ai/v1',
    apiKeyEnv: 'SAMBANOVA_API_KEY',
    // ID verificado na lista pública de modelos (curl 2026-08).
    textModel: () => envOr('SAMBANOVA_MODEL', 'Meta-Llama-3.3-70B-Instruct'),
    visionModel: () => null, // só texto
    jsonMode: false, // conservador — extractJSON trata a resposta na mesma
    extraHeaders: () => ({}),
    timeoutMs: 30_000,
    inChain: false, // reserva — fora da cadeia (Fase 19b)
  },
];

/* ─────────────────────────── disponibilidade ─────────────────────────── */

export function providerAvailable(p: ProviderConfig): boolean {
  return Boolean(process.env[p.apiKeyEnv]?.trim());
}

/** Há pelo menos um provider de IA configurado? */
export function aiAvailable(): boolean {
  return PROVIDERS.some(providerAvailable);
}

/** Modelo do provider para o tipo — `null` se não suporta. */
export function modelFor(p: ProviderConfig, type: ModelType): string | null {
  return type === 'text' ? p.textModel() : p.visionModel();
}

/** Cadeia efetiva para o tipo: na cadeia + com chave + modelo do tipo. */
export function configuredProviders(
  type: ModelType
): { provider: ProviderConfig; model: string }[] {
  return PROVIDERS.filter((p) => p.inChain !== false && providerAvailable(p))
    .map((provider) => ({ provider, model: modelFor(provider, type) }))
    .filter(
      (entry): entry is { provider: ProviderConfig; model: string } =>
        entry.model !== null
    );
}

/* ───────────────────────── chamada HTTP (fetch) ──────────────────────── */

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  /** Pedir resposta JSON estrita (se o provider suportar jsonMode). */
  json?: boolean;
}

/**
 * Uma chamada a UM provider. LANÇA em qualquer falha (a cadeia apanha) —
 * devolve o conteúdo textual normalizado.
 */
export async function callProvider(
  provider: ProviderConfig,
  model: string,
  messages: AiMessage[],
  opts: CallOptions = {}
): Promise<string> {
  const apiKey = process.env[provider.apiKeyEnv]?.trim();
  if (!apiKey) throw new Error(`${provider.apiKeyEnv} não configurada.`);

  const url = `${provider.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 500,
  };
  if (opts.json && provider.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...provider.extraHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(provider.timeoutMs),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 180);
    throw new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[] | null;
  } | null;

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  /* Alguns providers OpenAI-compat devolvem partes; concatena os de texto. */
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : ''
      )
      .join('')
      .trim();
  }
  return '';
}

/* ────────────────────────── cadeia de fallback ───────────────────────── */

export interface ChainAttempt {
  provider: string;
  model: string;
  error: string;
}

export interface ChainResult {
  content: string;
  provider: string;
  model: string;
  attempts: ChainAttempt[];
}

/**
 * Percorre a cadeia de providers configurados para o tipo, na ordem de
 * prioridade, até um responder. Nunca lança — devolve `null` se TODOS
 * falharem (o chamador aplica o seu fallback de negócio).
 */
export async function runFallbackChain(
  messages: AiMessage[],
  type: ModelType,
  opts: CallOptions = {}
): Promise<ChainResult | null> {
  const chain = configuredProviders(type);
  if (chain.length === 0) {
    console.error(
      '[lib/ai] nenhum provider configurado — define B_AI_API_KEY, ' +
        'OPENROUTER_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY ' +
        'ou SAMBANOVA_API_KEY.'
    );
    return null;
  }

  const attempts: ChainAttempt[] = [];
  for (const { provider, model } of chain) {
    try {
      const content = await callProvider(provider, model, messages, opts);
      if (content) {
        if (attempts.length > 0) {
          console.warn(
            `[lib/ai] fallback OK via ${provider.name}/${model} ` +
              `após ${attempts.length} falha(s).`
          );
        }
        return { content, provider: provider.name, model, attempts };
      }
      attempts.push({ provider: provider.name, model, error: 'resposta vazia' });
      console.error(
        `[lib/ai] ${provider.name} (${model}) devolveu resposta vazia — próximo provider.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ provider: provider.name, model, error: message });
      console.error(
        `[lib/ai] ${provider.name} (${model}) falhou: ${message.slice(0, 160)} — próximo provider.`
      );
    }
  }

  console.error(
    `[lib/ai] TODOS os providers falharam (${attempts.map((a) => a.provider).join(' → ')}).`
  );
  return null;
}

/* ────────────────────── extração robusta de JSON ─────────────────────── */

/**
 * Parse tolerante da resposta (providers/variações de modelos diferem):
 * aceita JSON puro, cercado por ```json …``` ou com texto à volta —
 * extrai o primeiro objeto balanceado.
 */
export function extractJSON<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/* ───────────────────────── diagnóstico (logs/admin) ──────────────────── */

export interface AiProviderStatus {
  name: string;
  label: string;
  available: boolean;
  textModel: string | null;
  visionModel: string | null;
}

/** Estado atual da cadeia (para logs de diagnóstico e páginas de estado). */
export function aiProvidersStatus(): AiProviderStatus[] {
  return PROVIDERS.map((p) => ({
    name: p.name,
    label: p.label,
    available: providerAvailable(p),
    textModel: modelFor(p, 'text'),
    visionModel: modelFor(p, 'vision'),
  }));
}
