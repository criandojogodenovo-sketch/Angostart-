import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/push/unsubscribe — remove UMA subscription do utilizador.
 * 🔒 Só o dono da subscription pode removê-la (user_id + endpoint).
 * Corpo: { endpoint }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'push-unsubscribe'), 15, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1024) {
    return NextResponse.json({ error: 'Endpoint inválido.' }, { status: 400 });
  }

  try {
    await sql`
      DELETE FROM push_subscriptions
      WHERE user_id = ${user.id} AND endpoint = ${endpoint}
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API push/unsubscribe POST] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível remover a subscription.' },
      { status: 503 }
    );
  }
}
