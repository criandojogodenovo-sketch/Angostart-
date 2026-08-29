import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Fase 7 — Web Push (VAPID).
 *
 * POST /api/push/subscribe — guarda a subscription do browser/telemóvel.
 *   Corpo: { subscription: { endpoint, keys: { p256dh, auth } } }
 * GET  /api/push/subscribe — estado: { enabled, subscribed, publicKey }
 */

interface SubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function isValidSubscription(sub: SubscriptionInput): sub is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  return (
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    sub.endpoint.length <= 1024 &&
    typeof sub.keys?.p256dh === 'string' &&
    sub.keys.p256dh.length >= 40 &&
    sub.keys.p256dh.length <= 256 &&
    typeof sub.keys?.auth === 'string' &&
    sub.keys.auth.length >= 12 &&
    sub.keys.auth.length <= 256
  );
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para ativar notificações.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'push-subscribe'), 15, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { subscription?: SubscriptionInput };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub || !isValidSubscription(sub)) {
    return NextResponse.json({ error: 'Subscription inválida.' }, { status: 400 });
  }

  try {
    const userAgent = request.headers.get('user-agent')?.slice(0, 250) ?? null;
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (${user.id}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${userAgent})
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent
    `;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('[API push/subscribe POST] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível guardar a subscription.' },
      { status: 503 }
    );
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  const enabled = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );

  if (!user) {
    return NextResponse.json({ enabled, subscribed: false, publicKey: null });
  }

  try {
    const rows = (await sql`
      SELECT 1 FROM push_subscriptions WHERE user_id = ${user.id} LIMIT 1
    `) as unknown as Record<string, unknown>[];
    return NextResponse.json({
      enabled,
      subscribed: rows.length > 0,
      // A chave pública serve-se do servidor (produção sem rebuild)
      publicKey: enabled ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : null,
    });
  } catch {
    return NextResponse.json({ enabled, subscribed: false, publicKey: null });
  }
}
