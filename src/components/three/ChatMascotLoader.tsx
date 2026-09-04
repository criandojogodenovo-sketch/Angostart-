'use client';

/**
 * AngoStart — Loader da mascote do CHAT (Fase 23).
 *
 * Mesma estratégia validada na Fase 22 (Avatar3DLoader), aplicada ao widget:
 *  1. `next/dynamic` ssr:false → three/R3F ficam num chunk SEPARADO — o 3D
 *     só é descarregado quando o chat é ABERTO (nunca no carregamento da
 *     página; se o utilizador já viu a home, o chunk está em cache);
 *  2. Sem WebGL ou `prefers-reduced-motion` → AVATAR 2D SVG simples (o
 *     boneco «sem 3D») com boca animada por CSS enquanto fala — o widget
 *     continua vivo em qualquer dispositivo;
 *  3. Contentor de altura FIXA em todos os estados → zero CLS.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ChatMascotProps } from './ChatMascot';
import { webglSupported } from './webgl';

// Chunk separado — só descarregado quando o chat abre (lazy).
const ChatMascot = dynamic<ChatMascotProps>(() => import('./ChatMascot'), {
  ssr: false,
  loading: () => null, // o fallback 2D já está visível durante a carga
});

/* ─────────────── Fallback 2D (SVG — o boneco sem 3D) ─────────────── */

/**
 * Mascote 2D: MESMA cara da mascote 3D (paleta igual), desenhada em SVG.
 * A boca mexe-se por CSS enquanto `speaking`; sobrancelhas/boca/olhos
 * reagem à emoção; inclina a cabeça quando pensa. Sem WebGL, sem custo.
 */
function Mascot2D({ speaking = false, thinking = false, emotion = 'neutro' }: ChatMascotProps) {
  const feliz = emotion === 'feliz';
  const preocupado = emotion === 'preocupado';
  const pensativo = emotion === 'pensativo' || thinking;

  const browStyle = (lado: 'esq' | 'dir'): React.CSSProperties => {
    const origem = lado === 'esq' ? '36px 35px' : '64px 35px';
    if (preocupado) return { transform: lado === 'esq' ? 'rotate(18deg)' : 'rotate(-18deg)', transformOrigin: origem, transition: 'transform .3s' };
    if (feliz) return { transform: `translateY(-2px) rotate(${lado === 'esq' ? -4 : 4}deg)`, transformOrigin: origem, transition: 'transform .3s' };
    return { transform: `rotate(${lado === 'esq' ? -6 : 6}deg)`, transformOrigin: origem, transition: 'transform .3s' };
  };

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="Mascote da AngoStart">
      {/* Sombra falsa */}
      <ellipse cx="50" cy="98" rx="26" ry="2.5" fill="#0f172a" opacity="0.12" />
      {/* Torso + colarinho (camisa azul da mascote) */}
      <path d="M18 100 C18 76 34 70 50 70 C66 70 82 76 82 100 Z" fill="#3b82f6" />
      <path d="M42 70 h16 v8 c0 3 -3 5 -8 5 s-8 -2 -8 -5 Z" fill="#f8fafc" />

      {/* Cabeça (grupo — inclina quando pensa) */}
      <g
        style={{
          transform: pensativo ? 'rotate(-6deg)' : 'rotate(0deg)',
          transformOrigin: '50px 60px',
          transition: 'transform .3s',
        }}
      >
        <circle cx="22" cy="48" r="5.5" fill="#f2b380" />
        <circle cx="78" cy="48" r="5.5" fill="#f2b380" />
        <circle cx="50" cy="48" r="30" fill="#f2b380" />
        {/* Cabelo (calota — igual ao 3D) */}
        <path d="M20 46 C22 24 36 16 50 16 C64 16 78 24 80 46 C74 34 64 28 50 28 C36 28 26 34 20 46 Z" fill="#312e4f" />
        {/* Sobrancelhas (reagem à emoção) */}
        <rect x="30" y="34" width="12" height="3" rx="1.5" fill="#312e4f" style={browStyle('esq')} />
        <rect x="58" y="34" width="12" height="3" rx="1.5" fill="#312e4f" style={browStyle('dir')} />
        {/* Olhos (semecerrados se preocupado; olham para cima se pensa) */}
        <g
          style={{
            transform: `${preocupado ? 'scaleY(0.6)' : 'scaleY(1)'} translateY(${pensativo ? -2 : 0}px)`,
            transformOrigin: '50px 47px',
            transition: 'transform .3s',
          }}
        >
          <circle cx="39" cy="47" r="3.2" fill="#1e293b" />
          <circle cx="61" cy="47" r="3.2" fill="#1e293b" />
        </g>
        {/* Boca: a mexer (CSS) se speaking; senão emoção */}
        {speaking ? (
          <ellipse cx="50" cy="61" rx="6" ry="7" fill="#7f1d1d" className="angostart-mascot-mouth" />
        ) : preocupado ? (
          <path d="M42 63 Q50 56 58 63" stroke="#b4562e" strokeWidth="3" strokeLinecap="round" fill="none" />
        ) : (
          <path
            d={feliz ? 'M40 58 Q50 68 60 58' : 'M42 60 Q50 66 58 60'}
            stroke="#b4562e"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
        )}
        {/* Bochechas */}
        <circle cx="27" cy="56" r="4" fill="#f1996b" opacity="0.55" />
        <circle cx="73" cy="56" r="4" fill="#f1996b" opacity="0.55" />
      </g>

      {/* Bolha de pensamento (2D — indigo, visível sobre fundo branco) */}
      {thinking && (
        <g className="angostart-mascot-think">
          <circle cx="84" cy="24" r="2.5" fill="#a5b4fc" />
          <circle cx="89" cy="15" r="3.5" fill="#a5b4fc" />
          <circle cx="94" cy="5" r="5" fill="#c7d2fe" />
        </g>
      )}
    </svg>
  );
}

/* ─────────────────────── Loader ─────────────────────── */

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
      <div className="flex h-full w-full items-end justify-center" aria-hidden="true">
        <Mascot2D {...props} />
      </div>
    );
  }

  return <ChatMascot {...props} />;
}
