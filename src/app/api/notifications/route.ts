import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { listNotifications, markNotificationsRead } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications — últimas notificações + contador de não lidas
 * (sino da Navbar).
 * POST /api/notifications — marca (todas ou ids) como lidas. Corpo: { ids?: number[] }
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, 'notif-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  try {
    const { items, unread } = await listNotifications(user.id);
    return NextResponse.json({ notifications: items, unread });
  } catch (error) {
    console.error('[API notifications GET] Erro:', error);
    return NextResponse.json({ notifications: [], unread: 0 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  }

  let ids: number[] | undefined;
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body.ids)) {
      ids = body.ids
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
    }
  } catch {
    /* corpo vazio → marca todas */
  }

  try {
    await markNotificationsRead(user.id, ids);
    const { items, unread } = await listNotifications(user.id);
    return NextResponse.json({ ok: true, notifications: items, unread });
  } catch (error) {
    console.error('[API notifications POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 503 });
  }
}
