import 'server-only';

/**
 * AngoStart — Fase 14: cliente central da Groq (IA generativa).
 *
 * ⚠️ SERVER-ONLY: `GROQ_API_KEY` nunca chega ao cliente — todas as chamadas
 * passam por aqui (importado apenas por rotas de API e crons).
 *
 * Modelos (configuráveis via env — valores por omissão verificados na Groq):
 *  - Chat/texto : GROQ_MODEL_CHAT  (omissão `llama-3.1-8b-instant` — rápido,
 *                 gratuito: ~14.400 req/dia no tier free).
 *  - Visão (VLM): GROQ_MODEL_VISION (omissão `meta-llama/llama-4-scout-17b-16e-instruct`
 *                 — multimodal de produção na Groq; o nome «qwen-3.6-27b» do
 *                 briefing não existe no catálogo da Groq, daí a env var).
 *
 * Design defensivo:
 *  - `groqAvailable()` — as features de IA são OPCIONAIS: sem chave, as rotas
 *    respondem 503 com mensagem amigável e o resto da plataforma funciona.
 *  - Timeout curto (AbortSignal) — a IA nunca deve travar um pedido de compra.
 *  - `groqChatJSON` / `groqVisionJSON` — modo JSON estrito + parse seguro
 *    (devolve `null` em qualquer falha; o chamador decide o fallback).
 *  - Retry 1× em 429 (rate limit do tier gratuito) com espera curta.
 */

import Groq from 'groq-sdk';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const GROQ_MODEL_CHAT =
  process.env.GROQ_MODEL_CHAT?.trim() || 'llama-3.1-8b-instant';
export const GROQ_MODEL_VISION =
  process.env.GROQ_MODEL_VISION?.trim() ||
  'meta-llama/llama-4-scout-17b-16e-instruct';

/** Timeout por chamada (ms) — chat curto; visão um pouco mais folgada. */
const CHAT_TIMEOUT_MS = 20_000;
const VISION_TIMEOUT_MS = 30_000;

/** Cliente partilhado (a SDK só é instanciada se houver chave). */
let client: Groq | null = null;

export function groqAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function groqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY não configurada.');
  }
  if (!client) {
    client = new Groq({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 });
  }
  return client;
}

/** Erro é de rate limit 429? (tier gratuito.) */
function isRateLimit(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 429
  );
}

export interface ChatOptions {
  /** Temperatura 0-1 (omissão 0.4 — respostas estáveis). */
  temperature?: number;
  /** Teto de tokens da resposta. */
  maxTokens?: number;
}

/** Chamada de texto simples — devolve o conteúdo ou `null` (nunca lança). */
export async function groqChatText(
  system: string,
  userContent: string,
  options: ChatOptions = {}
): Promise<string | null> {
  if (!groqAvailable()) return null;
  try {
    const completion = await withRetry(() =>
      groqClient().chat.completions.create(
        {
          model: GROQ_MODEL_CHAT,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 500,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
        },
        { timeout: CHAT_TIMEOUT_MS }
      )
    );
    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.error('[lib/groq] groqChatText falhou:', errorMessage(error));
    return null;
  }
}

/** Histórico multi-turn para o chatbot de suporte (últimas N mensagens). */
export async function groqChatTurns(
  system: string,
  turns: { role: 'user' | 'assistant'; content: string }[],
  options: ChatOptions = {}
): Promise<string | null> {
  if (!groqAvailable()) return null;
  try {
    const completion = await withRetry(() =>
      groqClient().chat.completions.create(
        {
          model: GROQ_MODEL_CHAT,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 500,
          messages: [{ role: 'system', content: system }, ...turns],
        },
        { timeout: CHAT_TIMEOUT_MS }
      )
    );
    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.error('[lib/groq] groqChatTurns falhou:', errorMessage(error));
    return null;
  }
}

/**
 * Chamada com resposta JSON estrita (`response_format: json_object`).
 * Devolve o objeto parseado ou `null` em qualquer falha/shape inválido.
 */
export async function groqChatJSON<T>(
  system: string,
  userContent: string,
  options: ChatOptions = {}
): Promise<T | null> {
  const raw = await groqChatRawJSON(system, userContent, options, GROQ_MODEL_CHAT);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error('[lib/groq] JSON inválido do modelo:', raw.slice(0, 200));
    return null;
  }
}

/** Visão (VLM): imagem data-URL + instrução → JSON estrito ou `null`. */
export async function groqVisionJSON<T>(
  system: string,
  imageDataUrl: string,
  options: ChatOptions = {}
): Promise<T | null> {
  if (!groqAvailable()) return null;
  try {
    const completion = await withRetry(() =>
      groqClient().chat.completions.create(
        {
          model: GROQ_MODEL_VISION,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'text', text: VISION_USER_PROMPT },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        },
        { timeout: VISION_TIMEOUT_MS }
      )
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('[lib/groq] groqVisionJSON falhou:', errorMessage(error));
    return null;
  }
}

/* ───────────────────────── auxiliares internos ───────────────────────── */

/* A instrução principal (o que extrair + schema JSON) vai no `system`;
   a mensagem `user` traz apenas a imagem com um lembrete curto. */
const VISION_USER_PROMPT =
  'Analisa a imagem em anexo e responde APENAS com o JSON pedido (sem texto extra).';

async function groqChatRawJSON(
  system: string,
  userContent: string,
  options: ChatOptions,
  model: string
): Promise<string | null> {
  if (!groqAvailable()) return null;
  try {
    const completion = await withRetry(() =>
      groqClient().chat.completions.create(
        {
          model,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
        },
        { timeout: CHAT_TIMEOUT_MS }
      )
    );
    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.error('[lib/groq] groqChatRawJSON falhou:', errorMessage(error));
    return null;
  }
}

/** 1 retry em 429 com espera de 1.2s — suave com o tier gratuito. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isRateLimit(error)) {
      await new Promise((r) => setTimeout(r, 1200));
      return fn();
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ─────────────── Segurança: filtro anti-injeção de prompt ─────────────── */

/**
 * Deteta tentativas clássicas de jailbreak/prompt-injection em texto de
 * utilizador (mensagens do chat, bios de vendedor, etc.) ANTES de chegarem
 * ao modelo. Não é exaustivo — é a primeira linha de defesa; o system
 * prompt reforça o comportamento e a resposta é sempre pós-validada.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /ignore\s+(as\s+)?(todas\s+)?(as\s+)?(instru[çc][õo]es|regras|prompts?)/i,
  /desconsider(e|a|ar)\s+(as\s+)?(instru[çc][õo]es|regras)/i,
  /(reveal|show|print|dump|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /(revela|mostra|imprime|repete|diz[- ]me)\s+(o\s+)?(teu|seu|o)\s*(system\s+)?(prompt|instru[çc][õo]es)/i,
  /you\s+are\s+now\s+(a|an)\s+(?!helpful)/i,
  /(act|behave)\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(danm?n|jailbreak|dan|unfiltered|uncensored)/i,
  /system\s*[:=]\s*/i,
  /<\/?system>|<\/?instructions?>/i,
  /\bdeveloper\s+mode\b/i,
];

export function containsPromptInjection(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060]/g, ''); // zero-width chars usados para ofuscar
  return INJECTION_PATTERNS.some((re) => re.test(normalized));
}

/* Verificação estática: garantir que a chave nunca é importada no cliente.
   (Este módulo tem `import 'server-only'` — qualquer import num componente
   quebra o build.) */
export const _GROQ_BASE_URL = GROQ_BASE_URL;
