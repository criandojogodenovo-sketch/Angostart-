'use client';

/**
 * AngoStart — Mapa de serviços ao domicílio (Leaflet + tema escuro).
 *
 * Requisito premium: tiles CARTO Dark Matter (escuros) para combinar com
 * o design #0F172A. Solicita a localização do utilizador (Geolocation API),
 * mostra o marcador do prestador e permite clicar para escolher o ponto
 * de serviço (modo editável).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import { centerForCity } from '@/lib/cidades-angola';

/** Coordenadas das principais cidades angolanas (em src/lib/cidades-angola.ts). */
export { CIDADES_ANGOLA } from '@/lib/cidades-angola';

/* Marcador personalizado (divIcon — sem assets externos) */
function makeMarkerIcon(color: string, glow: string, label?: string) {
  return L.divIcon({
    className: 'angostart-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="width:18px;height:18px;border-radius:9999px;background:${color};
                    box-shadow:0 0 0 5px ${glow}44,0 2px 8px rgba(0,0,0,.55);
                    border:2.5px solid #fff"></div>
        ${label ? `<div style="margin-top:6px;background:#0f172aee;color:#e2e8f0;
                    font:600 11px/1.2 'Segoe UI',sans-serif;padding:3px 8px;
                    border-radius:9999px;white-space:nowrap">${label}</div>` : ''}
      </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 13), { animate: true });
  }, [center, map]);
  return null;
}

function ClickHandler({ onPick }: { onPick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export interface ServiceMapProps {
  /** Ponto de atendimento do prestador (já guardado). */
  providerLat?: number | null;
  providerLng?: number | null;
  /** Cidade do prestador (usada como centro inicial). */
  cidade?: string | null;
  /** true → o cliente/vendedor pode clicar para definir o ponto de serviço. */
  editable?: boolean;
  /** Ponto escolhido (controlado) — modo editável. */
  pickedLat?: number | null;
  pickedLng?: number | null;
  onPick?: (lat: number, lng: number) => void;
  height?: number;
}

export default function ServiceMapInner({
  providerLat,
  providerLng,
  cidade,
  editable = false,
  pickedLat,
  pickedLng,
  onPick,
  height = 320,
}: ServiceMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);

  const initialCenter = useMemo<[number, number]>(() => {
    if (providerLat != null && providerLng != null) return [providerLat, providerLng];
    if (pickedLat != null && pickedLng != null) return [pickedLat, pickedLng];
    return centerForCity(cidade);
  }, [providerLat, providerLng, pickedLat, pickedLng, cidade]);

  const providerIcon = useMemo(() => makeMarkerIcon('#14b8a6', '#14b8a6', cidade ?? 'Prestador'), [cidade]);
  const pickIcon = useMemo(() => makeMarkerIcon('#f59e0b', '#f59e0b'), []);
  const userIcon = useMemo(() => makeMarkerIcon('#38bdf8', '#38bdf8'), []);

  function requestLocation() {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('O teu navegador não suporta localização.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(next);
        setLocating(false);
        mapRef.current?.setView(next, 15, { animate: true });
      },
      () => {
        setLocating(false);
        setGeoError('Não foi possível obter a tua localização (permissão negada).');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/60 shadow-lg" data-testid="service-map">
      <MapContainer
        center={initialCenter}
        zoom={13}
        style={{ height, width: '100%', background: '#0f172a' }}
        zoomControl={true}
        scrollWheelZoom={false}
        ref={(map) => {
          mapRef.current = map ?? null;
        }}
      >
        <TileLayer
          attribution='Tiles &copy; Esri — Source: Esri, USGS | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        <Recenter center={initialCenter} />
        <ClickHandler onPick={editable ? onPick : undefined} />

        {providerLat != null && providerLng != null && (
          <Marker position={[providerLat, providerLng]} icon={providerIcon} />
        )}
        {editable && pickedLat != null && pickedLng != null && (
          <Marker position={[pickedLat, pickedLng]} icon={pickIcon} />
        )}
        {userPos && <Marker position={userPos} icon={userIcon} />}
      </MapContainer>

      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs text-slate-300">
          <MapPin className="h-3.5 w-3.5 text-blue-300" />
          {editable
            ? 'Toca no mapa para escolher o ponto de serviço.'
            : 'Ponto de atendimento do prestador (mapa escuro).'}
        </p>
        <button
          type="button"
          onClick={requestLocation}
          disabled={locating}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-400 hover:text-blue-300 disabled:opacity-60"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crosshair className="h-3.5 w-3.5" />
          )}
          Usar a minha localização
        </button>
      </div>
      {geoError && (
        <p className="bg-slate-900 px-4 pb-3 text-xs text-rose-400" role="alert">
          {geoError}
        </p>
      )}
    </div>
  );
}
