import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { parseCoord, ANGOLA_LAT, ANGOLA_LNG } from '@/lib/geo';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/location — prestador envia a sua posição GPS.
 *
 * Chamado a cada 5 s pelo dashboard (Geolocation watchPosition →
 * setInterval de envio). Guarda prestador_lat/lng + timestamp na
 * encomenda; o cliente lê via GET /api/orders/[id]/tracking.
 *
 * 🔒 SEGURANÇA:
 * - Só o prestador do item de serviço ao domicílio pode reportar.
 * - Só durante rastreamento ativo (tracking_active = TRUE e não concluído).
 * - Coordenadas validadas nos limites de Angola + rate limit (a cada 5 s
 *   = 12/min; permitimos 30/min para tolerar retries de rede).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, 'track-post'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  let body: { latitude?: unknown; longitude?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const lat = parseCoord(body.latitude, ANGOLA_LAT);
  const lng = parseCoord(body.longitude, ANGOLA_LNG);
  if (lat === null || lng === null) {
    return NextResponse.json(
      { error: 'Coordenadas inválidas — fora de Angola ou malformadas.' },
      { status: 400 }
    );
  }

  try {
    const rows = (await sql`
      SELECT id, items, tracking_active, service_completed
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      id: number;
      items: { type?: string; seller_id?: number }[];
      tracking_active: boolean;
      service_completed: boolean;
    }[];

    const order = rows[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    const isServiceSeller = (order.items ?? []).some(
      (i) => i?.type === 'servico_domicilio' && Number(i?.seller_id) === user.id
    );
    if (!isServiceSeller) {
      return NextResponse.json(
        { error: 'Sem permissão para reportar localização desta encomenda.' },
        { status: 403 }
      );
    }

    if (!order.tracking_active || order.service_completed) {
      // Rastreamento parado (cliente confirmou ou nunca começou) —
      // resposta 200 para o cliente simplesmente parar de enviar.
      return NextResponse.json({ ok: true, tracking_active: false });
    }

    await sql`
      UPDATE orders
      SET prestador_lat = ${lat},
          prestador_lng = ${lng},
          prestador_loc_updated_at = now()
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true, tracking_active: true });
  } catch (error) {
    console.error('[API orders/location] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar a localização agora.' },
      { status: 503 }
    );
  }
}
