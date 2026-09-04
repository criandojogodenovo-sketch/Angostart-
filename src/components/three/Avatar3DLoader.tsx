'use client';

/**
 * AngoStart — Loader do Avatar 3D (Fases 22→24).
 *
 * Estratégia de performance (o 3D NUNCA atrasa o carregamento):
 *  1. `next/dynamic` → three/R3F ficam num chunk SEPARADO do bundle
 *     inicial (a primeira pintura não espera pelo WebGL);
 *  2. O canvas só monta ~300ms DEPOIS da hidratação (idle) → o LCP
 *     é sempre o texto do hero, não o 3D;
 *  3. Fallback gracioso (Fase 24): sem WebGL ou com prefers-reduced-motion
 *     → Mascot2D SVG (o personagem refinado: barba + óculos + dentes)
 *     com o chip de saudação;
 *  4. Contentor com altura fixa em TODOS os estados → zero CLS na
 *     troca SVG → WebGL.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Avatar3DProps } from './Avatar3D';
import { webglSupported } from './webgl';
import Mascot2D from '@/components/illustrations/Mascot2D';

// Chunk separado — só descarregado quando necessário (lazy).
const Avatar3D = dynamic<Avatar3DProps>(() => import('./Avatar3D'), {
  ssr: false,
  loading: () => null, // o fallback 2D já está visível durante a carga
});

type Avatar3DLoaderProps = Avatar3DProps & {
  /** Chip do fallback SVG (ex.: primeiro nome do utilizador). */
  fallbackChip?: string;
  className?: string;
};

export default function Avatar3DLoader({
  withGlasses = false,
  variant = 'visitante',
  fallbackChip = 'Olá!',
  className = '',
}: Avatar3DLoaderProps) {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Acessibilidade + dispositivos sem WebGL → SVG estático definitivo.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !webglSupported()) {
      setSupported(false);
      return;
    }
    // Monta o 3D depois da primeira pintura (não compete com o LCP).
    const id = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  if (!ready || !supported) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${className}`}
        aria-hidden="true"
      >
        <Mascot2D withGlasses={withGlasses} chipLabel={fallbackChip} />
      </div>
    );
  }

  return (
    <div className={`h-full w-full ${className}`}>
      <Avatar3D withGlasses={withGlasses} variant={variant} />
    </div>
  );
}
