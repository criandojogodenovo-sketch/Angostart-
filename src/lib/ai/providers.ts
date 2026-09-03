import 'server-only';

/**
 * AngoStart — Fase 14b/21: IA multi-provider com fallback chain e
 * ROTEAMENTO DE TAREFAS por modelo/chave (Fase 21).
 *
 * MISSÃO: a IA da plataforma NUNCA fica offline por rate limit ou modelo
 * indisponível de um único fornecedor. Custo zero (planos gratuitos).
 *
 * ROTEAMENTO POR TAREFA (Fase 21 — ver lib/ai/task-routing.ts):
 *   chat    → B.AI B_AI_API_KEY          → Hy3 (Tencent)  (chatbot)
 *   vision  → B.AI B_AI_API_KEY_VISION   → GLM-5.3-Flash  (comprovativos)
 *   monitor → B.AI B_AI_API_KEY_MONITOR  → Qwen3.8-Flash  (monitorização)
 *   Cada modelo fica na SUA área; se a chave dedicada falhar/ausente,
 *   as outras chaves B.AI servem de emergência e, depois, o resto da
 *   cadeia (OpenRouter free) entra como último recurso.
 *
 * CADEIA DE FALLBACK (ordem de prioridade; hotfix "IA não responde em
 * rede móvel" — timeouts subidos para 45s/30s a pedido do CTO, porque os
 * 15s/8s antigos CORTAVAM respostas que só demoravam a chegar em 4G):
 *   0. bai          — B.AI (gateway unificado estilo Z.ai): UMA chave, OpenAI-
 *                     compat, modelos flagship gratuitos (glm-5.3-flash,
 *                     deepseek-v4-flash; visão: deepseek-v4-flash-vision-exp).
 *                     PRINCIPAL — timeout 45s (redes móveis lentas de Angola).
 *   1. openrouter  — 18 modelos :free (50 req/dia; 1000/dia com ≥10 créditos
 *                    na conta; 20 req/min). Texto E visão (:free com imagem).
 *                    Fallback — timeout 30s.
 *   2. gemini      — Google AI Studio (OpenAI-compat). RESERVA ATIVADA
 *                    (hotfix): entra na cadeia quando B.AI E OpenRouter
 *                    atingem limites/rate — multimodal (texto+imagem).
 *   Se TODOS falharem, a rota devolve mensagem amigável ao utilizador.
 *
 * ORÇAMENTO DE TEMPO (deadline): a rota de chat passa um deadline (~55 s)
 * e cada tentativa usa min(timeout do provider, tempo restante) — o total
 * NUNCA excede o maxDuration=60 s da Vercel, mesmo com timeouts generosos.
 * Falhas rápidas (429/401) libertam o resto do orçamento para o próximo.
 *
 * RESERVA (fora da cadeia — `inChain: false`, reativáveis por env/commit se
 * o CTO decidir): groq, cerebras, sambanova. Continuam no status de
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
 *   B_AI_MODEL_CHAT (default hy3) / B_AI_MODEL_VISION (default
 *   GLM-5.3-Flash) / B_AI_MODEL_MONITOR (default Qwen3.8-Flash)
 *
 * Licenças (uso comercial): modelos open-weight — verificar os termos no
 * Hugging Face antes de uso comercial pesado (Llama Community License,
 * Gemma Terms of Use, Qwen/GLM Apache-2.0, etc.). Os endpoints geridos
 * cobrem o uso normal da plataforma.
 */

import {
  AI_TASKS,
  AI_TASK_ROUTES,
  resolveTaskKeyEnv,
  taskModel,
  type AiTask,
} from './task-routing';
import { logAiCall } from './logs';

export type ModelType = 'text' | 'vision';
export type { AiTask };

export type AiRole = 'system' | 'user' | 'assistant';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | {
      type: 'input_audio';
      input_audio: { data: string; format: string };
    };

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
  /** Fase 21: modelo dedicado à tarefa de monitorização (`null` = usa textModel). */
  monitorModel?: () => string | null;
  /**
   * Fase 21: env var da chave a usar na tarefa (roteamento multi-chave).
   * Só o gateway principal (bai) tem chaves dedicadas por tarefa — os
   * restantes providers devolvem a chave única.
   */
  taskKeyEnv?: (task: AiTask) => string | null;
  /** Enviar `response_format: json_object`? (extractJSON cobre os outros.) */
  jsonMode: boolean;
  extraHeaders: () => Record<string, string>;
  timeoutMs: number;
  /** Fase 19b: `false` = reserva — fora da cadeia de fallback (não é chamado). */
  inChain?: boolean;
}

/** Lê env var numérica no momento da chamada (tuning de timeout sem deploy). */
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
    /* Hotfix 502 (set. 2026): override por env — se o gateway bloquear o
       IP/região das functions da Vercel (403 no log [AI:ERR]), o CTO aponta
       B_AI_BASE_URL para um proxy próprio (ex.: Cloudflare Worker que
       encaminha /v1/* → https://api.b.ai/v1/*) SEM novo deploy de código. */
    baseURL: envOr('B_AI_BASE_URL', 'https://api.b.ai/v1'),
    apiKeyEnv: 'B_AI_API_KEY',
    // Defaults = roteamento por tarefa definido pelo CTO (Fase 21; chat
    //  passado a Hy3/Tencent em set/2026 — ver lib/ai/task-routing.ts):
    //  - chat    (B_AI_API_KEY)         → hy3
    //  - vision  (B_AI_API_KEY_VISION)  → GLM-5.3-Flash
    //  - monitor (B_AI_API_KEY_MONITOR) → Qwen3.8-Flash
    // IDs overridáveis por env; se um ID estiver errado, a cadeia salta
    // para o provider seguinte.
    textModel: () => taskModel('chat'),
    visionModel: () => taskModel('vision'),
    monitorModel: () => taskModel('monitor'),
    taskKeyEnv: (task) => resolveTaskKeyEnv(task),
    jsonMode: true,
    extraHeaders: () => ({}),
    // Hotfix "IA não responde": 15s cortava respostas válidas em redes
    // móveis lentas (o modelo levava 20-40s). 45s cobre o pior 4G;
    // overridável por env AI_TIMEOUT_BAI_MS sem novo deploy.
    timeoutMs: envNum('AI_TIMEOUT_BAI_MS', 45_000),
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
    // Hotfix: 8s era demasiado agressivo para o free tier em hora de pico
    // (fila do modelo) — 30s dá margem; overridável AI_TIMEOUT_OPENROUTER_MS.
    timeoutMs: envNum('AI_TIMEOUT_OPENROUTER_MS', 30_000),
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
    timeoutMs: envNum('AI_TIMEOUT_GEMINI_MS', 30_000),
    // Hotfix (CTO): reserva ATIVADA — 3.º fallback quando B.AI e OpenRouter
    // atingem limites/rate. Só é chamada se os dois primeiros falharem E
    // ainda haver orçamento de tempo no deadline da rota.
    inChain: true,
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
    name: 'cerebras', // (mantido como reserva)
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

/** Todas as envs de chave que o provider consegue usar (qualquer tarefa). */
export function providerKeyEnvs(p: ProviderConfig): string[] {
  if (p.taskKeyEnv) {
    /* Fase 21: as três chaves dedicadas do gateway principal. */
    return [
      ...new Set(
        AI_TASKS.map((t) => p.taskKeyEnv!(t)).filter(
          (env): env is string => typeof env === 'string'
        )
      ),
    ];
  }
  return [p.apiKeyEnv];
}

export function providerAvailable(p: ProviderConfig): boolean {
  return providerKeyEnvs(p).some((env) => Boolean(process.env[env]?.trim()));
}

/** Há pelo menos um provider de IA configurado? */
export function aiAvailable(): boolean {
  return PROVIDERS.some(providerAvailable);
}

/** Modelo do provider para o tipo — `null` se não suporta. */
export function modelFor(p: ProviderConfig, type: ModelType): string | null {
  return type === 'text' ? p.textModel() : p.visionModel();
}

/** Modelo do provider para a TAREFA (monitor usa o modelo dedicado). */
export function modelForTask(
  p: ProviderConfig,
  task: AiTask
): string | null {
  if (task === 'monitor') return p.monitorModel?.() ?? p.textModel();
  if (task === 'vision') return p.visionModel();
  return p.textModel();
}

/**
 * Cadeia efetiva para o tipo+tarefa: na cadeia + com chave da tarefa +
 * modelo do tipo. `task` só muda a RESOLUÇÃO de chave/modelo do gateway
 * principal; a ordem de providers é sempre a mesma.
 */
export function configuredProviders(
  type: ModelType,
  task: AiTask = type === 'vision' ? 'vision' : 'chat'
): { provider: ProviderConfig; model: string; keyEnv: string }[] {
  return PROVIDERS.filter((p) => p.inChain !== false && providerAvailable(p))
    .map((provider) => {
      const model = modelForTask(provider, task);
      const keyEnv = provider.taskKeyEnv
        ? provider.taskKeyEnv(task)
        : providerAvailable(provider)
          ? provider.apiKeyEnv
          : null;
      return { provider, model, keyEnv };
    })
    .filter(
      (
        entry
      ): entry is { provider: ProviderConfig; model: string; keyEnv: string } =>
        entry.model !== null && entry.keyEnv !== null
    );
}

/* ─────────────── diagnóstico fact-based (502 set. 2026) ──────────────── */

/**
 * Impressão digital MASCARADA da chave + FORMATO. Nunca loga a chave
 * completa — só 6 primeiros + 4 últimos caracteres, o comprimento e a
 * estrutura (presença de `.` = estilo antigo `id.secret`; chaves novas do
 * gateway não têm ponto). Permite confirmar NO LOG se a chave em produção
 * é da geração pós-migração sem a expor.
 */
function keyFingerprint(key: string): string {
  const masked =
    key.length <= 12
      ? `${key.slice(0, 2)}***(len=${key.length})`
      : `${key.slice(0, 6)}***${key.slice(-4)}(len=${key.length})`;
  return `${masked} formato=${key.includes('.') ? 'antigo(id.secret)' : 'novo(sem-ponto)'}`;
}

/** Classe o erro HTTP do provider para leitura rápida nos logs da Vercel. */
function classifyHttpError(status: number): string {
  if (status === 401) return 'AUTH — chave inválida/deprecada ou formato errado';
  if (status === 403) return 'BLOQUEIO — IP/região do gateway (usar B_AI_BASE_URL/proxy)';
  if (status === 404) return 'MODELO/ENDPOINT inexistente — modelo saiu do catálogo?';
  if (status === 400) return 'REQUEST inválida — modelo desconhecido ou parâmetro';
  if (status === 429) return 'RATE_LIMIT — quota/limite do provider atingido';
  if (status >= 500) return 'PROVIDER em dificuldade (upstream/down)';
  return 'ERRO_HTTP';
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
 * devolve o conteúdo textual normalizado. `task` escolhe a CHAVE (Fase 21);
 * `keyEnv` sobrepõe a env da chave quando a cadeia já a resolveu.
 */
export async function callProvider(
  provider: ProviderConfig,
  model: string,
  messages: AiMessage[],
  opts: CallOptions = {},
  keyEnv?: string | null,
  /** Hotfix deadline: limita esta chamada ao tempo restante do orçamento. */
  timeoutOverrideMs?: number
): Promise<string> {
  const envName = keyEnv || provider.taskKeyEnv?.('chat') || provider.apiKeyEnv;
  const apiKey = process.env[envName]?.trim();
  if (!apiKey) throw new Error(`${envName} não configurada.`);

  /* Timeout resolvido NO MOMENTO da chamada (tuning por env sem novo
     deploy — ex.: AI_TIMEOUT_BAI_MS / AI_TIMEOUT_OPENROUTER_MS) e
     limitado ao orçamento restante da rota (deadline). */
  const configuredMs = envNum(
    `AI_TIMEOUT_${provider.name.toUpperCase()}_MS`,
    provider.timeoutMs
  );
  const effectiveMs = timeoutOverrideMs
    ? Math.max(1_000, Math.min(configuredMs, timeoutOverrideMs))
    : configuredMs;

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

  /* 🩺 LOG DETALHADO (pedido): provider, modelo, URL efetiva, chave
     MASCARADA com formato e timeout efetivo — a primeira pista quando a
     IA falha (ex.: confirma no log se a chave em produção é da geração
     nova pós-migração). */
  const requestStartedAt = Date.now();
  console.info(
    `[AI:REQ] ${provider.name} model=${model} url=${url} key=${envName} ` +
      `chave=${keyFingerprint(apiKey)} timeout=${effectiveMs}ms`
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(effectiveMs),
    });
  } catch (error) {
    /* Falha ANTES de haver resposta HTTP (timeout, DNS, TLS) — classifica
       para não confundir "rede lenta" com "chave rejeitada". */
    const name = error instanceof Error ? error.name : '';
    const msg = error instanceof Error ? error.message : String(error);
    const kind =
      name === 'TimeoutError' || name === 'AbortError'
        ? 'TIMEOUT — gateway não respondeu no prazo (rede/upstream lento)'
        : 'REDE/DNS — sem ligação ao gateway (DNS, TLS ou IP bloqueado?)';
    console.error(
      `[AI:ERR] ${provider.name} [${kind}] ${name}: ${msg.slice(0, 200)} ` +
        `após ${Date.now() - requestStartedAt} ms`
    );
    throw error;
  }

  if (!response.ok) {
    /* 🩺 LOG DETALHADO (erro): status + CORPO EXATO do provider (inclui o
       request id do gateway) — é a pista que distingue 401 de chave
       deprecada, 403 de geo-block e 429 de rate limit. */
    const detail = (await response.text().catch(() => '')).slice(0, 400);
    console.error(
      `[AI:ERR] ${provider.name} HTTP ${response.status} ` +
        `[${classifyHttpError(response.status)}] body=${detail || '(corpo vazio)'}`
    );
    throw new Error(
      `HTTP ${response.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
    );
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[] | null;
  } | null;

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    console.info(
      `[AI:OK] ${provider.name} model=${model} ` +
        `${Date.now() - requestStartedAt} ms, ${content.length} chars`
    );
    return content.trim();
  }
  /* Alguns providers OpenAI-compat devolvem partes; concatena os de texto. */
  if (Array.isArray(content)) {
    const joined = content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : ''
      )
      .join('')
      .trim();
    console.info(
      `[AI:OK] ${provider.name} model=${model} ` +
        `${Date.now() - requestStartedAt} ms (partes, ${joined.length} chars)`
    );
    return joined;
  }
  /* 🩺 Shape inesperado (ex.: gateway migrou o formato de resposta) — loga
     o JSON cru em vez de falhar em silêncio como "resposta vazia". */
  console.error(
    `[AI:ERR] ${provider.name} resposta com shape inesperado — ` +
      `JSON=${data ? JSON.stringify(data).slice(0, 400) : '(corpo não-JSON)'}`
  );
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
 * Percorre a cadeia de providers configurados para o tipo+tarefa, na ordem
 * de prioridade, até um responder. Nunca lança — devolve `null` se TODOS
 * falharem (o chamador aplica o seu fallback de negócio).
 *
 * Fase 21: cada tentativa bem-sucedida (ou a falha TOTAL) fica registada
 * em ai_logs (fire-and-forget) para a secção «IA Interna» do admin.
 */
export async function runFallbackChain(
  messages: AiMessage[],
  type: ModelType,
  opts: CallOptions = {},
  task: AiTask = type === 'vision' ? 'vision' : 'chat',
  /** Epoch ms — nenhuma tentativa ultrapassa este limite (rota Vercel). */
  deadline?: number
): Promise<ChainResult | null> {
  const chain = configuredProviders(type, task);
  if (chain.length === 0) {
    console.error(
      '[lib/ai] nenhum provider configurado — define B_AI_API_KEY (chat), ' +
        'B_AI_API_KEY_VISION (comprovativos), B_AI_API_KEY_MONITOR '
        + '(monitorização) ou a chave de algum provider de reserva.'
    );
    return null;
  }

  const attempts: ChainAttempt[] = [];
  const startedAt = Date.now();
  for (const { provider, model, keyEnv } of chain) {
    /* Orçamento de tempo: sem deadline usa o timeout nativo do provider;
       com deadline, cada tentativa fica limitada ao tempo restante — e
       paramos ANTES de iniciar uma chamada que já não teria 3 s úteis. */
    const remainingMs = deadline ? deadline - Date.now() : Infinity;
    if (remainingMs < 3_000) {
      console.error(
        `[lib/ai] orçamento de tempo esgotado (${Math.round(remainingMs)} ms) ` +
          `— interrompo a cadeia antes de ${provider.name}.`
      );
      break;
    }
    const timeoutOverride = Number.isFinite(remainingMs)
      ? Math.min(provider.timeoutMs, remainingMs)
      : undefined;
    try {
      const content = await callProvider(
        provider,
        model,
        messages,
        opts,
        keyEnv,
        timeoutOverride
      );
      if (content) {
        if (attempts.length > 0) {
          console.warn(
            `[lib/ai] fallback OK via ${provider.name}/${model} ` +
              `após ${attempts.length} falha(s).`
          );
        }
        void logAiCall({
          task,
          provider: provider.name,
          model,
          ok: true,
          latencyMs: Date.now() - startedAt,
        });
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

  void logAiCall({
    task,
    provider: attempts[0]?.provider ?? 'nenhum',
    model: attempts[0]?.model ?? '—',
    ok: false,
    latencyMs: Date.now() - startedAt,
    error: attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ') || 'sem providers',
  });
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

/**
 * Estado por TAREFA (Fase 21) — para a secção «IA Interna» do admin:
 * modelo em uso, chave dedicada configurada?, env de emergência usada.
 */
export interface AiTaskStatus {
  task: AiTask;
  label: string;
  audience: 'utilizadores' | 'admin';
  description: string;
  model: string;
  dedicatedKeyConfigured: boolean;
  /** Env da chave efetivamente usada (dedicada ou emergência). */
  activeKeyEnv: string | null;
  /** Alguma chave disponível (dedicada ou emergência)? */
  available: boolean;
}

export function aiTasksStatus(): AiTaskStatus[] {
  return AI_TASKS.map((task) => {
    const route = AI_TASK_ROUTES[task];
    const dedicated = Boolean(process.env[route.apiKeyEnv]?.trim());
    const activeKeyEnv = resolveTaskKeyEnv(task);
    return {
      task,
      label: route.label,
      audience: route.audience,
      description: route.description,
      model: taskModel(task),
      dedicatedKeyConfigured: dedicated,
      activeKeyEnv,
      available: activeKeyEnv !== null,
    };
  });
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
