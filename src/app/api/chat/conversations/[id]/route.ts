import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

export interface ChatMessageRow {
  id: number;
  sender_id: number;
  content: string;
  created_at: string;
}

/**
 * GET /api/chat/conversations/[id] — mensagens da conversa.
 * 🔒 Apenas as DUAS partes da conversa podem ler as mensagens.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, 'chat-read'), 120, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const convId = Number(id);
  if (!Number.isInteger(convId) || convId <= 0) {
    return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 });
  }

  try {
    const conversations = (await sql`
      SELECT id, user_id, seller_id, product_id
      FROM conversations WHERE id = ${convId} LIMIT 1
    `) as unknown as { id: number; user_id: number; seller_id: number; product_id: number | null }[];

    const conversation = conversations[0];
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    }
    if (conversation.user_id !== user.id && conversation.seller_id !== user.id) {
      return NextResponse.json(
        { error: 'Sem permissão — esta conversa não te pertence.' },
        { status: 403 }
      );
    }

    const messages = (await sql`
      SELECT id, sender_id, content, created_at
      FROM messages
      WHERE conversation_id = ${convId}
      ORDER BY created_at ASC, id ASC
      LIMIT 200
    `) as unknown as ChatMessageRow[];

    return NextResponse.json({ conversation, messages });
  } catch (error) {
    console.error('[API chat/conversations/[id]] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a conversa.' }, { status: 503 });
  }
}
