import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import {
  fuzzCoordinate,
  haversineMeters,
  estimateEtaMinutes,
} from '@/lib/geo';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/orders/[id]/tracking — estado do rastreamento em tempo real.
 *
 * Polling do cliente a cada 5 s (setInterval em /perfil):
 *  - posição atual do prestador (exata — é pública por natureza);
 *  - posição APROXIMADA do cliente (fuzz ~500 m — a exata NUNCA sai
 *    do servidor);
 *  - ETA estimado (Haversine ÷ velocidade média de Luanda);
 *  - flags: service_started_at, tracking_active, service_completed.
 *
 * 🔒 Só o cliente (dono da encomenda) ou um admin pode ler.
 * Se o cliente nunca partilhou GPS (latitude/longitude NULL) o mapa
 * mostra apenas o prestador + nota explicativa.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  // Polling a cada 5 s = 12/min — limite 40/min por IP (abas/retries)
  if (!rateLimit(clientKey(request, 'tracking-get'), 40, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, status, latitude, longitude,
             prestador_lat, prestador_lng, prestador_loc_updated_at,
             service_started_at, tracking_active, service_completed, service_completed_at
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number | null;
      status: string;
      latitude: number | null;
      longitude: number | null;
      prestador_lat: number | null;
      prestador_lng: number | null;
      prestador_loc_updated_at: string | null;
      service_started_at: string | null;
      tracking_active: boolean;
      service_completed: boolean;
      service_completed_at: string | null;
    }[];

    const order = rows[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }

    // 🔒 Autorização: dono da encomenda (cliente) ou admin
    const isAdmin =
      user.role === 'admin' ||
      user.role === 'admin_limitado' ||
      user.email === process.env.ADMIN_EMAIL;
    if (order.user_id !== user.id && !isAdmin) {
      return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    }

    let etaMinutes: number | null = null;
    let distanceMeters: number | null = null;
    let clientLat: number | null = null;
    let clientLng: number | null = null;

    if (order.latitude != null && order.longitude != null) {
      // 🔒 PRIVACIDADE: cliente sempre fuzzado dentro de 500 m (determinístico
      // por encomenda — não salta entre polls)
      const fuzzed = fuzzCoordinate(order.latitude, order.longitude, order.id);
      clientLat = fuzzed.lat;
      clientLng = fuzzed.lng;

      if (order.prestador_lat != null && order.prestador_lng != null) {
        distanceMeters = haversineMeters(
          order.prestador_lat,
          order.prestador_lng,
          order.latitude,
          order.longitude
        );
        etaMinutes = estimateEtaMinutes(distanceMeters);
      }
    }

    return NextResponse.json({
      tracking: {
        order_id: order.id,
        status: order.status,
        tracking_active: order.tracking_active,
        service_started_at: order.service_started_at,
        service_completed: order.service_completed,
        service_completed_at: order.service_completed_at,
        prestador_lat: order.prestador_lat,
        prestador_lng: order.prestador_lng,
        prestador_loc_updated_at: order.prestador_loc_updated_at,
        client_lat: clientLat,
        client_lng: clientLng,
        client_has_gps: order.latitude != null && order.longitude != null,
        distance_meters: distanceMeters !== null ? Math.round(distanceMeters) : null,
        eta_minutes: etaMinutes,
      },
    });
  } catch (error) {
    console.error('[API orders/tracking] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar o rastreamento agora.' },
      { status: 503 }
    );
  }
}
