import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireRole } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** Angola continental — limites geográficos para validação. */
const ANGOLA_LAT = [-18.5, -4.5] as const;
const ANGOLA_LNG = [11.0, 25.0] as const;

function parseCoord(value: unknown, range: readonly [number, number]): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < range[0] || num > range[1]) return null;
  return Math.round(num * 1e6) / 1e6;
}

/**
 * POST /api/perfil/location — botão "Estou disponível" (Fase 5, mapa).
 *
 * O prestador ao domicílio partilha a sua posição atual (aproximada) e fica
 * visível como disponível por 2 horas. Clientes sem encomenda paga veem
 * apenas a posição DESLOCADA (raio ~500 m) — privacidade por defeito.
 * Corpo: { latitude, longitude } ou { clear: true } para ficar indisponível.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'location'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { latitude?: unknown; longitude?: unknown; clear?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  try {
    if (body.clear === true) {
      await sql`
        UPDATE users SET latitude = NULL, longitude = NULL, available_until = NULL
        WHERE id = ${auth.user.id}
      `;
      return NextResponse.json({ ok: true, available: false });
    }

    const lat = parseCoord(body.latitude, ANGOLA_LAT);
    const lng = parseCoord(body.longitude, ANGOLA_LNG);
    if (lat === null || lng === null) {
      return NextResponse.json(
        { error: 'Localização fora de Angola ou inválida.' },
        { status: 400 }
      );
    }

    await sql`
      UPDATE users
      SET latitude = ${lat}, longitude = ${lng}, available_until = now() + interval '2 hours'
      WHERE id = ${auth.user.id}
    `;
    return NextResponse.json({ ok: true, available: true, until: '+2h' });
  } catch (error) {
    console.error('[API perfil/location] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a localização.' }, { status: 503 });
  }
}
