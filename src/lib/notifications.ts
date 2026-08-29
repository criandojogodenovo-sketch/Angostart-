import 'server-only';
import { sql } from '@/lib/db';

/**
 * AngoStart — Notificações no site (sino) — server-side.
 *
 * Cria notificações internas exibidas no sino da Navbar. Melhor-esforço:
 * nunca deve quebrar o fluxo principal (encomenda, chat, carteira).
 */

export interface NotificationRow {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export async function pushNotification(
  userId: number,
  title: string,
  body?: string | null,
  link?: string | null
): Promise<void> {
  try {
    await sql`
      INSERT INTO notifications (user_id, title, body, link)
      VALUES (${userId}, ${title.slice(0, 120)}, ${body?.slice(0, 400) ?? null}, ${link ?? null})
    `;
  } catch (error) {
    console.error('[notifications] Falha ao criar notificação:', error);
  }

  // Web Push no telemóvel/browser (Fase 7) — melhor-esforço, nunca quebra
  // o fluxo principal (chat, encomendas, propostas, carteira).
  try {
    const { sendWebPushToUser } = await import('@/lib/push');
    await sendWebPushToUser(userId, { title, body, url: link });
  } catch {
    /* push opcional */
  }
}

export async function listNotifications(
  userId: number,
  limit = 20
): Promise<{ items: NotificationRow[]; unread: number }> {
  const items = (await sql`
    SELECT id, title, body, link, read::boolean, created_at
    FROM notifications
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as unknown as NotificationRow[];

  const unreadRows = (await sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE user_id = ${userId} AND read = FALSE
  `) as unknown as { n: number }[];

  return { items, unread: unreadRows[0]?.n ?? 0 };
}

export async function markNotificationsRead(userId: number, ids?: number[]): Promise<void> {
  if (ids && ids.length > 0) {
    await sql`
      UPDATE notifications SET read = TRUE
      WHERE user_id = ${userId}
        AND id = ANY(string_to_array(${ids.join(',')}, ',')::int[])
    `;
    return;
  }
  await sql`UPDATE notifications SET read = TRUE WHERE user_id = ${userId} AND read = FALSE`;
}
