import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeText } from '@/lib/security';
import { aiAvailable, aiChatTurns } from '@/lib/ai/chat';
import { AI_SUPPORT_SYSTEM_PROMPT } from '@/lib/ai/knowledge';
import { containsPromptInjection } from '@/lib/ai/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/chat — Fase 14: chatbot de suporte AngoStart (IA multi-provider).
 *
 * - Cadeia de fallback: B.AI → OpenRouter → Gemini → Groq → Cerebras →
 *   SambaNova (lib/ai/chat.ts) — server-only, chaves nunca expostas ao cliente.
 * - Rate limit: máx. 10 req/min por utilizador (ou IP se anónimo).
 * - Segurança: filtro anti-injeção ANTES do modelo + system prompt
 *   comprometido com a AngoStart (não promete o que não pode, nunca pede
 *   senha/pagamento fora da plataforma, aponta para os sítios certos).
 * - O system prompt vive em lib/ai/knowledge.ts — base de conhecimento
 *   com TODAS as funcionalidades do produto (Busbt, Pedidos no Ar,
 *   contactos, estabelecimentos, keywords, comissões…). Atualizá-la
 *   sempre que o produto ganhar features novas.
 * - Sem chave configurada → 503 com mensagem amigável (a plataforma
 *   funciona na mesma).
 */

const MAX_TURNS = 10; // últimas 10 mensagens vão ao modelo (contexto curto)
const MAX_CONTENT_LEN = 800;

interface IncomingTurn {
  role?: unknown;
  content?: unknown;
}

export async function POST(request: NextRequest) {
  /* 🔒 10 req/min: por utilizador autenticado, senão por IP. */
  const user = await getAuthUser(request).catch(() => null);
  if (!rateLimit(clientKey(request, user ? `ai-chat-u${user.id}` : 'ai-chat-anon'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Aguarda um minuto antes de enviares mais mensagens.' },
      { status: 429 }
    );
  }

  let body: { messages?: unknown };
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

  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) {
    return NextResponse.json({ error: 'Envia uma mensagem para o suporte.' }, { status: 400 });
  }

  /* 🛡️ Anti-injeção: tentativa de jailbreak nem chega ao modelo. */
  if (containsPromptInjection(lastUser.content)) {
    return NextResponse.json({
      reply:
        'Não posso alterar as minhas regras de funcionamento — sou o suporte da AngoStart. ' +
        'Como te posso ajudar com compras, vendas, Busbt, Pedidos no Ar, carteira ou a tua conta?',
      flagged: true,
    });
  }

  if (!aiAvailable()) {
    return NextResponse.json(
      {
        error:
          'O assistente de IA está temporariamente indisponível. Fala connosco em geral@angostart.ao ou no WhatsApp +244 958 176 915.',
        code: 'AI_UNAVAILABLE',
      },
      { status: 503 }
    );
  }

  const reply = await aiChatTurns(AI_SUPPORT_SYSTEM_PROMPT, turns, { maxTokens: 400 });
  if (!reply) {
    return NextResponse.json(
      {
        error:
          'Não consegui contactar a IA. Tenta novamente ou contacta o suporte.',
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ reply });
}
