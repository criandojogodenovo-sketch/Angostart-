import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/contact-requests/[id]/chat — o CLIENTE clica «Ir para Chat»
 * depois de o prestador aceitar o contacto.
 *
 * Cria (ou reutiliza) a conversa 1-para-1 SEM produto associado
 * (product_id NULL — conversa de serviço personalizado). Guarda o id da
 * conversa no pedido de contacto e devolve-o para o cliente abrir o chat.
 *
 * 🔒 PRIVACIDADE: a localização exata do cliente NUNCA aparece aqui —
 * apenas a zona aproximada. O telefone nunca é partilhado. A localização
 * exata é desbloqueada apenas pelo pagamento.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `contact-chat:${user.id}`), 15, 10 * 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const requestId = Number(rawId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  try {
    // O pedido existe, pertence ao cliente e foi aceite?
    const rows = (await sql`
      SELECT id, provider_id, conversation_id, status
      FROM contact_requests
      WHERE id = ${requestId} AND client_id = ${user.id}
      LIMIT 1
    `) as unknown as {
      id: number;
      provider_id: number;
      conversation_id: number | null;
      status: string;
    }[];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pedido de contato não encontrado.' }, { status: 404 });
    }
    const request_ = rows[0];
    if (request_.status !== 'aceite') {
      return NextResponse.json(
        { error: 'Este pedido ainda não foi aceite pelo prestador.' },
        { status: 409 }
      );
    }

    // Conversa já criada antes → devolve diretamente
    if (request_.conversation_id) {
      return NextResponse.json(
        { ok: true, conversation_id: request_.conversation_id, reused: true },
        { status: 200 }
      );
    }

    // Reutiliza conversa sem produto entre o mesmo par (evita duplicados —
    // o UNIQUE(user_id, seller_id, product_id) não cobre NULLs em Postgres)
    const existing = (await sql`
      SELECT id FROM conversations
      WHERE user_id = ${user.id} AND seller_id = ${request_.provider_id} AND product_id IS NULL
      LIMIT 1
    `) as unknown as { id: number }[];

    let conversationId: number;
    if (existing.length > 0) {
      conversationId = existing[0].id;
    } else {
      const inserted = (await sql`
        INSERT INTO conversations (user_id, seller_id, product_id)
        VALUES (${user.id}, ${request_.provider_id}, NULL)
        RETURNING id
      `) as unknown as { id: number }[];
      conversationId = inserted[0].id;

      // Notifica o prestador de que a conversa está aberta (melhor-esforço)
      await pushNotification(
        request_.provider_id,
        'Nova conversa aberta 💬',
        `${user.name} abriu o chat depois do teu aceite — responde rápido para conquistar o cliente.`,
        `/chat?c=${conversationId}`
      );
    }

    // Liga a conversa ao pedido de contacto (idempotente)
    await sql`
      UPDATE contact_requests
         SET conversation_id = ${conversationId},
             updated_at = NOW()
       WHERE id = ${requestId}
    `;

    return NextResponse.json(
      { ok: true, conversation_id: conversationId, reused: existing.length > 0 },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API contact-requests chat] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível abrir o chat agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
