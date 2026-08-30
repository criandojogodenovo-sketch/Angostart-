'use client';

/**
 * AngoStart — Wrapper do mapa de rastreamento.
 * O Leaflet acede a `window` — carregamos com dynamic(ssr:false).
 */

import dynamic from 'next/dynamic';
import type { TrackingData } from './ServiceTrackingMapInner';

export type { TrackingData };

const ServiceTrackingMapInner = dynamic(
  () => import('./ServiceTrackingMapInner'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900">
        <span className="text-sm text-slate-400">A carregar o mapa…</span>
      </div>
    ),
  }
);

export default function ServiceTrackingMap({
  tracking,
  orderId,
}: {
  tracking: TrackingData | null;
  orderId: number;
}) {
  return <ServiceTrackingMapInner tracking={tracking} orderId={orderId} />;
}
