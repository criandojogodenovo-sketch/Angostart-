import 'server-only';

/**
 * AngoStart — Fase 14b: chamadas de TEXTO com cadeia de fallback.
 *
 * Ordem tentada (providers com chave configurada):
 *   B.AI → OpenRouter → Gemini → Groq → Cerebras → SambaNova
 *
 * Contrato (igual ao antigo lib/groq.ts): NUNCA lança — devolve `null`
 * quando a IA não está disponível ou todos os providers falham; o chamador
 * aplica o fallback de negócio (mensagem humana, nota anterior mantida…).
 */

import {
  extractJSON,
  runFallbackChain,
  type AiMessage,
  type AiTask,
} from './providers';

/* Re-export para os call sites importarem tudo de um sítio só. */
export { aiAvailable } from './providers';

export interface ChatOptions {
  /** Temperatura 0-1 (omissão 0.4 — respostas estáveis). */
  temperature?: number;
  /** Teto de tokens da resposta. */
  maxTokens?: number;
  /**
   * Fase 21: tarefa que escolhe a chave/modelo do gateway principal
   * (default 'chat'; 'monitor' para lote admin — Qwen3.8-Flash).
   */
  task?: AiTask;
  /**
   * Hotfix "IA não responde": epoch ms limite para a cadeia inteira —
   * cada provider usa min(seu timeout, tempo restante). Rotas Vercel
   * passam maxDuration − margem para a resposta nunca ser cortada.
   */
  deadline?: number;
}

export interface AiTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatResult<T> {
  data: T;
  /** Provider que respondeu (auditoria/logs). */
  provider: string;
  model: string;
}

function asMessages(system: string, turns: AiTurn[]): AiMessage[] {
  return [{ role: 'system', content: system }, ...turns];
}

/** Histórico multi-turn (chatbot de suporte). Devolve texto ou `null`. */
export async function aiChatTurns(
  system: string,
  turns: AiTurn[],
  options: ChatOptions = {}
): Promise<string | null> {
  const result = await runFallbackChain(
    asMessages(system, turns),
    'text',
    {
      temperature: options.temperature ?? 0.4,
      maxTokens: options.maxTokens ?? 500,
    },
    options.task ?? 'chat',
    options.deadline
  );
  return result?.content ?? null;
}

/** Chamada de texto simples (system + 1 mensagem do utilizador). */
export async function aiChatText(
  system: string,
  userContent: string,
  options: ChatOptions = {}
): Promise<string | null> {
  return aiChatTurns(system, [{ role: 'user', content: userContent }], options);
}

/**
 * Chamada com resposta JSON. Devolve `{data, provider, model}` ou `null`
 * em qualquer falha/shape inválido (parse tolerante via extractJSON).
 */
export async function aiChatJSON<T>(
  system: string,
  userContent: string,
  options: ChatOptions = {}
): Promise<AiChatResult<T> | null> {
  const result = await runFallbackChain(
    asMessages(system, [{ role: 'user', content: userContent }]),
    'text',
    {
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 400,
      json: true,
    },
    options.task ?? 'chat'
  );
  if (!result) return null;

  const data = extractJSON<T>(result.content);
  if (!data) {
    console.error(
      `[lib/ai/chat] JSON inválido do provider ${result.provider} (${result.model}):`,
      result.content.slice(0, 200)
    );
    return null;
  }
  return { data, provider: result.provider, model: result.model };
}
