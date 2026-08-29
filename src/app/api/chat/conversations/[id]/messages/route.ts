import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { sanitizeMultiline, clientKey, rateLimit } from '@/lib/security';
import { detectContactSharing, logSuspiciousActivity } from '@/lib/antifraud';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/conversations/[id]/messages — envia uma mensagem.
 *
 * - 🔒 Apenas as duas partes da conversa.
 * - Anti-burla: se a mensagem contiver email/telefone/WhatsApp, a tentativa
 *   é REGISTADA (tentativa_fora) e a mensagem segue com aviso — 2
 *   deteções bloqueiam a conta automaticamente.
 * - Notifica o destinatário: sino no site + email (Resend, melhor-esforço).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  // 20 mensagens / minuto
  if (!rateLimit(clientKey(request, 'chat-send'), 20, 60_000)) {
    return NextResponse.json(
      { error: 'Estás a enviar mensagens demasiado rápido. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  const { id } = await params;
  const convId = Number(id);
  if (!Number.isInteger(convId) || convId <= 0) {
    return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 });
  }

  let body: { content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const content = sanitizeMultiline(body.content, 2000);
  if (content.length < 1) {
    return NextResponse.json({ error: 'Escreve uma mensagem antes de enviar.' }, { status: 400 });
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

    /* ── Anti-burla: partilha de contactos para negociar fora da plataforma ── */
    const contactHits = detectContactSharing(content);
    if (contactHits.length > 0) {
      logSuspiciousActivity({
        userId: user.id,
        action: 'tentativa_fora',
        details: `Contactos detetados no chat (conversa #${convId}): padrões ${contactHits.length}. Mensagem: "${content.slice(0, 120)}"`,
        severity: 'media',
      }).catch(() => {});
    }

    const inserted = (await sql`
      INSERT INTO messages (conversation_id, sender_id, content)
      VALUES (${convId}, ${user.id}, ${content})
      RETURNING id, sender_id, content, created_at
    `) as unknown as { id: number; sender_id: number; content: string; created_at: string }[];

    await sql`
      UPDATE conversations SET last_message_at = now() WHERE id = ${convId}
    `;

    /* ── Notifica o destinatário (sino + email melhor-esforço) ── */
    const recipientId =
      conversation.user_id === user.id ? conversation.seller_id : conversation.user_id;

    await pushNotification(
      recipientId,
      'Nova mensagem no chat',
      `${user.name}: ${content.slice(0, 80)}`,
      `/chat?c=${convId}`
    );

    notifyByEmail(recipientId, user.name, convId, content).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        message: inserted[0],
        warning:
          contactHits.length > 0
            ? 'Não partilhes contactos pessoais — negociar fora da AngoStart remove a tua proteção e é monitorizado.'
            : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API chat/messages POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível enviar a mensagem.' }, { status: 503 });
  }
}

/** Email de nova mensagem (melhor-esforço — nunca bloqueia o chat). */
async function notifyByEmail(
  recipientId: number,
  senderName: string,
  convId: number,
  preview: string
): Promise<void> {
  try {
    const rows = (await sql`
      SELECT email FROM users WHERE id = ${recipientId} LIMIT 1
    `) as unknown as { email: string | null }[];
    const to = rows[0]?.email;
    if (!to) return;

    const { getAppUrl } = await import('@/lib/env');
    const { sendChatNotificationEmail } = await import('@/lib/email');
    await sendChatNotificationEmail(to, senderName, preview, `${getAppUrl()}/chat?c=${convId}`);
  } catch {
    /* email opcional */
  }
}
