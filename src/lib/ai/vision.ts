import 'server-only';

/**
 * AngoStart — Fase 14b: visão (VLM) com cadeia de fallback.
 *
 * Cadeia de VISÃO (só providers multimodais e com chave):
 *   B.AI (deepseek-v4-flash-vision-exp) →
 *   OpenRouter (google/gemma-4-31b-it:free) →
 *   Gemini (gemini-2.5-flash) →
 *   Groq (llama-4-scout)
 *
 * (Cerebras e SambaNova são só-texto — saltados automaticamente.)
 *
 * Contrato: NUNCA lança — devolve `null` se a IA não estiver disponível
 * ou todos os providers falharem. O chamador (verificação de comprovativos)
 * mantém o fluxo seguro: comprovativo fica em revisão manual + alerta admin.
 */

import { extractJSON, runFallbackChain } from './providers';

export interface VisionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface AiVisionResult<T> {
  data: T;
  /** Provider que respondeu (auditoria — ex.: orders.ai_verification). */
  provider: string;
  model: string;
}

/* A instrução principal (o que extrair + schema JSON) vai no `system`;
   a mensagem `user` traz apenas a imagem com um lembrete curto. */
const VISION_USER_PROMPT =
  'Analisa a imagem em anexo e responde APENAS com o JSON pedido (sem texto extra).';

/** Imagem data-URL + instrução → JSON estrito `{data, provider, model}` ou `null`. */
export async function aiVisionJSON<T>(
  system: string,
  imageDataUrl: string,
  options: VisionOptions = {}
): Promise<AiVisionResult<T> | null> {
  const result = await runFallbackChain(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_USER_PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    'vision',
    {
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens ?? 400,
      json: true,
    }
  );
  if (!result) return null;

  const data = extractJSON<T>(result.content);
  if (!data) {
    console.error(
      `[lib/ai/vision] JSON inválido do provider ${result.provider} (${result.model}):`,
      result.content.slice(0, 200)
    );
    return null;
  }
  return { data, provider: result.provider, model: result.model };
}
