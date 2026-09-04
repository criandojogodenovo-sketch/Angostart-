'use client';

/**
 * AngoStart — Mascot3DLoader (Fase 24 · loader unificado).
 *
 * Estratégia validada nas Fases 22/23, agora para o componente canónico:
 *  1. `next/dynamic` ssr:false → three/R3F/drei ficam num chunk SEPARADO
 *     (a primeira pintura nunca espera pelo WebGL; home/chat/painel
 *     partilham o MESMO chunk — fica em cache entre áreas);
 *  2. Sem WebGL ou prefers-reduced-motion → Mascot2D (SVG premium, a MESMA
 *     cara: barba + óculos + dentes) com boca animada por CSS no chat;
 *  3. Contentor de altura fixa em todos os estados → zero CLS;
 *  4. A montagem 3D só acontece depois da primeira pintura (idle ~300 ms)
 *     no contexto home; chat/painel montam quase de imediato (acção
 *     explícita do utilizador — sem risco para o LCP).
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Mascot3DProps } from './MascotCharacter';
import { webglSupported } from './webgl';
import Mascot2D from '@/components/illustrations/Mascot2D';

// Chunk separado — só descarregado quando necessário (lazy).
const Mascot3D = dynamic<Mascot3DProps>(() => import('./Mascot3D'), {
  ssr: false,
  loading: () => null, // o fallback 2D já está visível durante a carga
});

export default function Mascot3DLoader(props: Mascot3DProps) {
  const { context = 'home', isLoggedIn = false } = props;
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    /* Acessibilidade + dispositivos sem WebGL → 2D definitivo. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !webglSupported()) {
      setSupported(false);
      return;
    }
    /* Home: monta depois da primeira pintura (não compete com o LCP);
       chat/painel são acções explícitas — 150 ms chegam. */
    const delay = context === 'home' ? 300 : 150;
    const id = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(id);
  }, [context]);

  if (!ready || !supported) {
    return (
      <div
        className="flex h-full w-full items-end justify-center"
        aria-hidden={context !== 'chat'}
        role={context === 'chat' ? 'img' : undefined}
      >
        <Mascot2D
          withGlasses={context === 'home' ? isLoggedIn : true}
          speaking={props.speaking}
          thinking={props.thinking}
          emotion={props.emotion}
        />
      </div>
    );
  }

  return <Mascot3D {...props} />;
}
