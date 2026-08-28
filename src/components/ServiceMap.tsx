'use client';

/**
 * AngoStart — Wrapper do mapa de serviços.
 * O Leaflet acede a `window` — carregamos o mapa com dynamic(ssr:false)
 * para evitar erros de SSR/hidratação.
 */

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { ServiceMapProps } from './ServiceMapInner';

export { centerForCity } from '@/lib/cidades-angola';

const ServiceMapInner = dynamic(() => import('./ServiceMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
      <span className="text-sm text-slate-400">A carregar o mapa…</span>
    </div>
  ),
});

export default function ServiceMap(props: ServiceMapProps) {
  return <ServiceMapInner {...props} />;
}
