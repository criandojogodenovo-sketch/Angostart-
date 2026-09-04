'use client';

/**
 * AngoStart — Loader da mascote do CHAT (Fases 23→24).
 *
 * Mesma estratégia validada na Fase 22, aplicada ao widget:
 *  1. `next/dynamic` ssr:false → three/R3F ficam num chunk SEPARADO — o 3D
 *     só é descarregado quando o chat é ABERTO (nunca no carregamento da
 *     página; se o utilizador já viu a home, o chunk está em cache);
 *  2. Sem WebGL ou `prefers-reduced-motion` → Mascot2D (Fase 24: o MESMO
 *     personagem em SVG — barba + óculos + dentes) com boca animada por CSS
 *     enquanto fala — o widget continua vivo em qualquer dispositivo;
 *  3. Contentor de altura FIXA em todos os estados → zero CLS.
 *
 * Fase 24: prop extra `wave` — aceno de boas-vindas quando o chat abre.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ChatMascotProps } from './ChatMascot';
import { webglSupported } from './webgl';
import Mascot2D from '@/components/illustrations/Mascot2D';

// Chunk separado — só descarregado quando o chat abre (lazy).
const ChatMascot = dynamic<ChatMascotProps>(() => import('./ChatMascot'), {
  ssr: false,
  loading: () => null, // o fallback 2D já está visível durante a carga
});

/* ─────────────── Loader ─────────────── */

export default function ChatMascotLoader(props: ChatMascotProps) {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    /* Acessibilidade + dispositivos sem WebGL → 2D definitivo. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !webglSupported()) {
      setSupported(false);
      return;
    }
    /* Monta o 3D logo (o chat já é uma acção explícita do utilizador —
       não há LCP em risco; 150 ms só para o chunk respirar). */
    const id = window.setTimeout(() => setReady(true), 150);
    return () => window.clearTimeout(id);
  }, []);

  if (!ready || !supported) {
    return (
      <div className="flex h-full w-full items-end justify-center" role="img" aria-hidden={false}>
        <Mascot2D
          withGlasses
          speaking={props.speaking}
          thinking={props.thinking}
          emotion={props.emotion}
        />
      </div>
    );
  }

  return <ChatMascot {...props} />;
}
