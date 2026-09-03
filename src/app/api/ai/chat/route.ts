import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeText } from '@/lib/security';
import { aiAvailable, aiChatTurns } from '@/lib/ai/chat';
import {
  runFallbackChain,
  type AiMessage,
} from '@/lib/ai/providers';
import { AI_SUPPORT_SYSTEM_PROMPT } from '@/lib/ai/knowledge';
import { containsPromptInjection } from '@/lib/ai/security';
import { consumeDailyQuota } from '@/lib/ai/usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/* Hotfix 502 (set. 2026): fixa a região da função em `iad1` (US East),
   INDEPENDENTE da definição do painel Vercel — se o gateway B.AI bloquear
   alguma região/egress, todas as rotas de IA correm na mesma região
   conhecida (e, se necessário, via proxy B_AI_BASE_URL). O log do pedido
   imprime VERCEL_REGION para confirmar a região efetiva em produção. */
export const preferredRegion = 'iad1';

/**
 * POST /api/ai/chat — Fase 14/21: chatbot de suporte AngoStart (multimodal).
 *
 * - Roteamento (Fase 21): tarefa 'chat' → B.AI Hy3 (Tencent, ID `hy3`;
 *   antes MiMo-V2.5), com fallback OpenRouter free. Chaves nunca expostas.
 * - TEXTO: histórico multi-turn (últimas 10 mensagens) — como antes.
 * - IMAGEM: o utilizador anexa 1 imagem/mensagem (JPG/PNG/WebP ≤ 5 MB);
 *   o modelo multimodal analisa e responde. Quota 10 imagens/dia.
 * - ÁUDIO: o utilizador envia áudio ≤ 2 min; o sistema transcreve
 *   (1 chamada) e responde ao texto (1 chamada). Quota 3 transcrições/dia.
 * - Rate limit: máx. 30 req/min por utilizador (ou IP se anónimo).
 * - Hotfix "respostas cortadas" (set/2026): max_tokens 2048 na resposta do
 *   chat (era 400/500 — frases eram truncadas a meio, finish_reason=length)
 *   e 1024 na transcrição (áudio de 2 min excedia 500 tokens).
 * - O utilizador NUNCA vê qual modelo/provider respondeu — detalhe interno.
 * - Sem chave configurada → 503 com mensagem amigável (a plataforma
 *   funciona na mesma).
 */

const MAX_TURNS = 10; // últimas 10 mensagens vão ao modelo (contexto curto)
const MAX_CONTENT_LEN = 800;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // ~2 min de Opus/HE-AAC cabem folgados

/* Hotfix "IA não responde": orçamento total da cadeia de IA (todos os
   providers em cascata) — fica 5 s abaixo do maxDuration=60 s da Vercel
   para o JSON/resposta chegar ao cliente. Cada provider usa
   min(seu timeout, tempo restante); falhas rápidas (429/401) libertam
   orçamento para o fallback seguinte. */
const AI_BUDGET_MS = 55_000;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const AUDIO_FORMATS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mpeg',
  'audio/mp4': 'mp4',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

const TRANSCRIBE_SYSTEM =
  'És um transcritor de áudio para a plataforma AngoStart. Transcreve ' +
  'LITERALMENTE o áudio em português (pode ter sotaque angolano e ruído de ' +
  'fundo). Responde APENAS com o texto transcrito, sem comentários, sem ' +
  'markdown, sem aspas. Se o áudio estiver ininteligível, responde ' +
  'exatamente: [áudio ininteligível]';

interface IncomingTurn {
  role?: unknown;
  content?: unknown;
}

/** Valida e parte um data-URL. Devolve {mime, base64} ou null. */
function parseDataUrl(value: unknown): { mime: string; base64: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: match[2] };
}

/** Tamanho decodificado (bytes) de um bloco base64. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  /* Hotfix: orçamento partilhado por TODAS as chamadas de IA deste pedido
     (transcrição + resposta em cascata no caso de áudio). */
  const deadline = startedAt + AI_BUDGET_MS;

  /* 🔒 30 req/min: por utilizador autenticado, senão por IP. */
  const user = await getAuthUser(request).catch(() => null);
  if (!rateLimit(clientKey(request, user ? `ai-chat-u${user.id}` : 'ai-chat-anon'), 30, 60_000)) {
    console.warn(
      `[API /api/ai/chat] 429 rate limit — user=${user?.id ?? 'anónimo'} ` +
        `em ${Date.now() - startedAt} ms`
    );
    return NextResponse.json(
      { error: 'Aguarda um minuto antes de enviares mais mensagens.' },
      { status: 429 }
    );
  }

  let body: { messages?: unknown; image?: unknown; audio?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? (body.messages as IncomingTurn[]) : [];
  const turns = raw
    .filter(
      (t) =>
        t &&
        typeof t.content === 'string' &&
        (t.role === 'user' || t.role === 'assistant')
    )
    .slice(-MAX_TURNS)
    .map((t) => ({
      role: t.role as 'user' | 'assistant',
      content: sanitizeText(t.content as string, MAX_CONTENT_LEN),
    }))
    .filter((t) => t.content.length > 0);

  /* ── Imagem anexada (opcional; 1 por mensagem; exige sessão) ── */
  let imagePart: { type: 'image_url'; image_url: { url: string } } | null = null;
  if (body.image) {
    if (!user) {
      return NextResponse.json(
        { error: 'Entra na tua conta para enviar imagens ao suporte.' },
        { status: 401 }
      );
    }
    const img = parseDataUrl(body.image);
    if (!img || !IMAGE_TYPES.includes(img.mime as (typeof IMAGE_TYPES)[number])) {
      return NextResponse.json(
        { error: 'Formato de imagem não suportado — usa JPG, PNG ou WebP.' },
        { status: 400 }
      );
    }
    if (base64Bytes(img.base64) > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: 'A imagem excede o limite de 5 MB.' },
        { status: 413 }
      );
    }
    const okQuota = await consumeDailyQuota(user.id, 'images');
    if (!okQuota) {
      return NextResponse.json(
        {
          error:
            'Alcançaste o limite diário de imagens (10). Tenta novamente amanhã.',
          code: 'QUOTA_EXCEEDED',
        },
        { status: 429 }
      );
    }
    imagePart = { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } };
  }

  /* ── Áudio anexado (opcional; ≤2 min; quota 3/dia; exige sessão) ── */
  let audioTranscript: string | null = null;
  if (body.audio) {
    if (!user) {
      return NextResponse.json(
        { error: 'Entra na tua conta para enviar áudio ao suporte.' },
        { status: 401 }
      );
    }
    const aud = parseDataUrl(body.audio);
    const format = aud ? AUDIO_FORMATS[aud.mime] : undefined;
    if (!aud || !format) {
      return NextResponse.json(
        { error: 'Formato de áudio não suportado — grava em webm, ogg, mp3, m4a ou wav.' },
        { status: 400 }
      );
    }
    if (base64Bytes(aud.base64) > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'O áudio é demasiado grande — limita a 2 minutos.' },
        { status: 413 }
      );
    }
    const okQuota = await consumeDailyQuota(user.id, 'transcriptions');
    if (!okQuota) {
      return NextResponse.json(
        {
          error:
            'Alcançaste o limite diário de transcrições (3). Tenta novamente amanhã ou escreve a tua dúvida.',
          code: 'QUOTA_EXCEEDED',
        },
        { status: 429 }
      );
    }

    /* Transcrição: tarefa 'chat' (mesma chave/modelo multimodal). 1 chamada.
       Hotfix truncagem: 500 tokens cortava transcrições de áudio perto de
       2 min (pt falado ≈ 1,3 token/palavra) — 1024 cobre o pior caso. */
    const result = await runFallbackChain(
      [
        { role: 'system', content: TRANSCRIBE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcreve o áudio a seguir.' },
            { type: 'input_audio', input_audio: { data: aud.base64, format } },
          ],
        },
      ],
      'text',
      { temperature: 0, maxTokens: 1024 },
      'chat',
      deadline
    );
    const transcript = result?.content?.trim();
    if (!transcript || /^\[áudio ininteligível\]$/i.test(transcript)) {
      return NextResponse.json(
        {
          error:
            'Não consegui transcrever o áudio. Tenta gravar de novo com menos ruído ou escreve a tua dúvida.',
          code: 'TRANSCRIPTION_FAILED',
        },
        { status: 502 }
      );
    }
    audioTranscript = sanitizeText(transcript, MAX_CONTENT_LEN);
  }

  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser && !imagePart && !audioTranscript) {
    return NextResponse.json({ error: 'Envia uma mensagem para o suporte.' }, { status: 400 });
  }

  /* Texto efetivo do último turno do utilizador (com anexos descritos). */
  const userText = audioTranscript
    ? `[Áudio do utilizador transcrito]: ${audioTranscript}`
    : lastUser?.content ?? '';

  /* 🛡️ Anti-injeção: tentativa de jailbreak nem chega ao modelo. */
  if (userText && containsPromptInjection(userText)) {
    console.warn(
      `[API /api/ai/chat] injeção bloqueada — user=${user?.id ?? 'anónimo'}`
    );
    return NextResponse.json({
      reply:
        'Não posso alterar as minhas regras de funcionamento — sou o suporte da AngoStart. ' +
        'Como te posso ajudar com compras, vendas, Busbt, Pedidos no Ar, carteira ou a tua conta?',
      flagged: true,
    });
  }

  if (!aiAvailable()) {
    console.error(
      '[API /api/ai/chat] 503 — nenhum provider de IA configurado (sem chaves no ambiente).'
    );
    return NextResponse.json(
      {
        error:
          'O assistente de IA está temporariamente indisponível. Fala connosco em geral@angostart.ao ou no WhatsApp +244 958 176 915.',
        code: 'AI_UNAVAILABLE',
      },
      { status: 503 }
    );
  }

  /* Histórico para o modelo: se há imagem, o último turno vira partes
     multimodais (texto + imagem); caso contrário, texto simples. */
  console.info(
    `[API /api/ai/chat] pedido user=${user?.id ?? 'anónimo'} ` +
      `região=${process.env.VERCEL_REGION ?? 'local'} ` +
      `turns=${turns.length} imagem=${imagePart ? 'sim' : 'não'} ` +
      `áudio=${audioTranscript ? 'sim' : 'não'}`
  );
  const modelTurns: { role: 'user' | 'assistant'; content: string }[] = turns;
  if (imagePart) {
    /* Substitui o último turno do utilizador por versão com anotação. */
    const withImage = modelTurns.map((t, i) =>
      i === modelTurns.length - 1 && t.role === 'user'
        ? {
            role: t.role,
            content:
              `${t.content || 'Analisa a imagem que anexei.'}\n\n[O utilizador anexou uma imagem — analisa-a e responde em pt-AO.]`.trim(),
          }
        : t
    );
    const messages: AiMessage[] = [
      { role: 'system', content: AI_SUPPORT_SYSTEM_PROMPT },
      ...withImage.slice(0, -1).map((t) => ({ role: t.role, content: t.content }) as AiMessage),
      {
        role: 'user',
        content: [
          { type: 'text', text: withImage[withImage.length - 1].content },
          imagePart,
        ],
      },
    ];
    const reply = await aiChatTurnsFromMessages(messages, deadline);
    return finish(reply);
  }

  const reply = await aiChatTurns(
    AI_SUPPORT_SYSTEM_PROMPT,
    [
      ...modelTurns.slice(0, -1),
      { role: 'user', content: userText || 'Olá!' },
    ],
    { maxTokens: 2048, deadline }
  );
  return finish(reply);

  /* Resposta final (o cliente nunca vê provider/modelo). */
  function finish(r: string | null) {
    const latency = Date.now() - startedAt;
    if (!r) {
      console.error(
        `[API /api/ai/chat] 502 sem resposta após ${latency} ms — ` +
          'todos os providers falharam (ver [AI:REQ]/[AI:ERR] acima para o status e corpo exatos).'
      );
      return NextResponse.json(
        {
          error:
            'Não consegui contactar a IA. Tenta novamente ou contacta o suporte.',
          code: 'AI_CHAIN_FAILED',
        },
        { status: 502 }
      );
    }
    console.info(`[API /api/ai/chat] 200 OK em ${latency} ms`);
    return NextResponse.json({ reply: r });
  }
}

/** Chamada direta com mensagens já multimodais (imagem na última). */
async function aiChatTurnsFromMessages(
  messages: AiMessage[],
  deadline: number
): Promise<string | null> {
  const result = await runFallbackChain(
    messages,
    'text',
    /* Hotfix truncagem (set/2026): 500 cortava respostas com imagem a meio
       (finish_reason=length); 2048 alinha com o caminho de texto puro. */
    { temperature: 0.4, maxTokens: 2048 },
    'chat',
    deadline
  );
  return result?.content ?? null;
}
