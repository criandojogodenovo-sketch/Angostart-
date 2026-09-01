'use client';

/**
 * AngoStart — Mapa de RASTREAMENTO em tempo real (serviços ao domicílio).
 *
 * Ponto 4B do prompt:
 *  - 🛵 marcador AZUL: posição atual do prestador (GPS a cada 5 s);
 *  - 🏠 marcador VERMELHO: posição APROXIMADA do cliente (raio 500 m —
 *    a exata nunca sai do servidor);
 *  - ⏱️ tempo estimado de chegada (Haversine ÷ velocidade média), atualizado
 *    junto com a posição (polling a cada 5 s contra /api/orders/[id]/tracking).
 *
 * Leaflet acede a `window` — usar sempre via o wrapper ServiceTrackingMap
 * (dynamic ssr:false), como o ServiceMap.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Bike, Clock, Loader2, MapPin } from 'lucide-react';

export interface TrackingData {
  order_id: number;
  status: string;
  tracking_active: boolean;
  service_started_at: string | null;
  service_completed: boolean;
  service_completed_at: string | null;
  prestador_lat: number | null;
  prestador_lng: number | null;
  prestador_loc_updated_at: string | null;
  client_lat: number | null;
  client_lng: number | null;
  client_has_gps: boolean;
  distance_meters: number | null;
  eta_minutes: number | null;
}

function makeMarkerIcon(color: string, glow: string, label: string) {
  return L.divIcon({
    className: 'angostart-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="width:18px;height:18px;border-radius:9999px;background:${color};
                    box-shadow:0 0 0 5px ${glow}44,0 2px 8px rgba(0,0,0,.55);
                    border:2.5px solid #fff"></div>
        <div style="margin-top:6px;background:#0f172aee;color:#e2e8f0;
                    font:600 11px/1.2 'Segoe UI',sans-serif;padding:3px 8px;
                    border-radius:9999px;white-space:nowrap">${label}</div>
      </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Mantém a câmara centrada nos dois marcadores sem "roubar" o zoom. */
function FollowTrack({
  a,
  b,
}: {
  a: [number, number] | null;
  b: [number, number] | null;
}) {
  const map = useMap();
  const lastKey = useRef('');
  useEffect(() => {
    const pts = [a, b].filter(Boolean) as [number, number][];
    if (pts.length === 0) return;
    const key = pts.flat().join(',');
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (pts.length === 1) {
      map.setView(pts[0], 15, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
    }
  }, [a, b, map]);
  return null;
}

export default function ServiceTrackingMapInner({
  tracking,
  orderId,
}: {
  tracking: TrackingData | null;
  orderId: number;
}) {
  const prestadorIcon = useMemo(
    () => makeMarkerIcon('#38bdf8', '#38bdf8', 'Prestador'),
    []
  );
  const clientIcon = useMemo(
    () => makeMarkerIcon('#ef4444', '#ef4444', 'Local do serviço'),
    []
  );

  const prestadorPos: [number, number] | null =
    tracking?.prestador_lat != null && tracking?.prestador_lng != null
      ? [tracking.prestador_lat, tracking.prestador_lng]
      : null;
  const clientPos: [number, number] | null =
    tracking?.client_lat != null && tracking?.client_lng != null
      ? [tracking.client_lat, tracking.client_lng]
      : null;

  /* Centro inicial: prestador, cliente, ou Luanda */
  const center = useMemo<[number, number]>(() => {
    return prestadorPos ?? clientPos ?? [-8.838333, 13.234444];
  }, [prestadorPos, clientPos]);

  const lastUpdate = tracking?.prestador_loc_updated_at
    ? new Date(tracking.prestador_loc_updated_at).toLocaleTimeString('pt-PT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/60 shadow-lg" data-testid="tracking-map">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Bike className="h-3.5 w-3.5 text-sky-400" />
          Rastreamento em tempo real — pedido #{orderId}
        </p>
        {tracking?.service_completed ? (
          <span className="rounded-full bg-blue-600/20 px-2.5 py-1 text-[11px] font-bold text-blue-300">
            Serviço concluído ✓
          </span>
        ) : tracking?.tracking_active && prestadorPos ? (
          <span className="flex items-center gap-1.5 rounded-full bg-sky-500/20 px-2.5 py-1 text-[11px] font-bold text-sky-300">
            <Loader2 className="h-3 w-3 animate-spin" /> Ao vivo · atualiza a cada 5 s
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-300">
            A aguardar início do prestador
          </span>
        )}
      </div>

      <MapContainer
        center={center}
        zoom={14}
        style={{ height: 300, width: '100%', background: '#0f172a' }}
        zoomControl
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='Tiles &copy; Esri | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        <FollowTrack a={prestadorPos} b={clientPos} />
        {prestadorPos && <Marker position={prestadorPos} icon={prestadorIcon} />}
        {clientPos && <Marker position={clientPos} icon={clientIcon} />}
        {prestadorPos && clientPos && (
          <Polyline
            positions={[prestadorPos, clientPos]}
            pathOptions={{ color: '#38bdf8', weight: 2, dashArray: '6 8', opacity: 0.7 }}
          />
        )}
      </MapContainer>

      <div className="grid gap-2 bg-slate-900 px-4 py-3 sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-blue-300" />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              Tempo estimado
            </p>
            <p className="text-sm font-bold text-white">
              {tracking?.eta_minutes != null
                ? `~${tracking.eta_minutes} min`
                : 'A calcular…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              Distância
            </p>
            <p className="text-sm font-bold text-white">
              {tracking?.distance_meters != null
                ? tracking.distance_meters >= 1000
                  ? `${(tracking.distance_meters / 1000).toFixed(1)} km`
                  : `${tracking.distance_meters} m`
                : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400" />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              Última posição
            </p>
            <p className="text-sm font-bold text-white">{lastUpdate ?? '—'}</p>
          </div>
        </div>
      </div>
      {!tracking?.client_has_gps && (
        <p className="bg-slate-900 px-4 pb-3 text-[11px] text-amber-300">
          O cliente não partilhou GPS neste pedido — o mapa mostra apenas a
          posição do prestador.
        </p>
      )}
    </div>
  );
}
