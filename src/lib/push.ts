import 'server-only';
import webpush from 'web-push';
import { sql } from '@/lib/db';

/**
 * AngoStart — Web Push (Fase 7) — notificações no telemóvel/browser.
 *
 * 🔒 SEGURANÇA:
 * - `server-only`: as chaves VAPID privadas nunca saem do servidor.
 * - Só enviamos para subscriptions registadas por utilizadores autenticados.
 * - A remoção de uma subscription só é permitida ao seu dono (ver rota).
 * - Melhor-esforço: falhas de push NUNCA quebram o fluxo principal
 *   (encomenda, chat, proposta). Subscriptions mortas (404/410) são
 *   removidas automaticamente.
 */

export function pushEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

function vapidSubject(): string {
  return process.env.VAPID_SUBJECT || 'mailto:geral@angostart.ao';
}

/** Configura o web-push (uma vez por instância quente). */
let configured = false;
function ensureConfigured(): boolean {
  if (!pushEnabled()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      vapidSubject(),
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string
    );
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body?: string | null;
  /** Caminho interno a abrir ao clicar (ex.: /perfil). */
  url?: string | null;
}

/**
 * Envia uma notificação push para TODAS as subscriptions do utilizador.
 * Fire-and-forget seguro: devolve o nº de envios bem-sucedidos.
 */
export async function sendWebPushToUser(
  userId: number,
  payload: PushPayload
): Promise<number> {
  if (!ensureConfigured()) return 0;

  let subs: { id: number; endpoint: string; p256dh: string; auth: string }[] = [];
  try {
    subs = (await sql`
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE user_id = ${userId}
    `) as unknown as typeof subs;
  } catch (error) {
    console.error('[push] Falha ao ler subscriptions:', error);
    return 0;
  }

  const json = JSON.stringify(payload);
  let sent = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        json
      );
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      // 404/410 — subscription expirou: remove para não acumular lixo
      if (statusCode === 404 || statusCode === 410) {
        await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`.catch(() => {});
      } else {
        console.error('[push] Falha ao enviar:', statusCode ?? error);
      }
    }
  }
  return sent;
}
