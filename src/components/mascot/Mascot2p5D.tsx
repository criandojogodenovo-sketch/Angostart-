'use client';

/**
 * AngoStart — Mascot2p5D (mascote 2.5D premium · ilustração + CSS).
 *
 * Substitui por completo o antigo boneco WebGL (primitivas R3F): o MESMO
 * personagem das referências (rapaz de barba, sorriso com dentes, óculos)
 * agora é uma ILUSTRAÇÃO de alta qualidade (PNG transparente, gerada a
 * partir das mesmas referências) com profundidade 100% CSS/HTML:
 *
 *   - Sombra elíptica projectada no chão (radial-gradient + blur) que
 *     «respira» em contra-fase com a flutuação → efeito de peso real;
 *   - Flutuação suave (translateY) + respiração (escala) + «aceno»
 *     (rotação sutil do corpo — a mão já vem erguida na ilustração);
 *   - Piscar de olhos simulado por micro-impulso de brilho (~5,2s);
 *   - CHAT: enquanto `speaking` a imagem PULSA (escala + brilho ~2,6 Hz)
 *     sincronizada com o estado isTyping/typewriter; `thinking` inclina
 *     a cabeça (pose) + mostra bolha de pensamento;
 *   - Halo radial suave atrás do personagem (gradiente da marca) para
 *     separar a figura do fundo — profundidade sem WebGL.
 *
 * Áreas (MESMA mascote, consistência visual total):
 *   home visitante → /mascot/mascot-visitante.png (aceno, sem óculos);
 *   home logado    → /mascot/mascot-logado.png (óculos + crachá + telemóvel);
 *   chat/painel    → /mascot/mascot-busto.png (retrato com óculos).
 *
 * Performance: ZERO WebGL, zero JS de runtime — só <picture> + keyframes
 * CSS (GPU). WebP primeiro com fallback PNG; lazy loading fora do hero;
 * se a imagem falhar → ícone simples (Bot). Contentor de altura fixa
 * herdada do pai → zero CLS. `prefers-reduced-motion` desliga tudo.
 */

import { useState } from 'react';
import { Bot } from 'lucide-react';
import type { MascotEmotion } from '@/lib/mascot-emotions';

export type MascotContext = 'home' | 'chat' | 'dashboard';

/** Reacção da mascote do painel aos dados (não inventa valores). */
export type MascotMood = 'neutral' | 'positive' | 'alert';

export type Mascot2p5DProps = {
  /** Área do site — muda ilustração, enquadramento e animações. */
  context?: MascotContext;
  /** Home: autenticado → variante com óculos/crachá/telemóvel. */
  isLoggedIn?: boolean;
  /** CHAT: a imagem pulsa enquanto a resposta é revelada (isTyping). */
  speaking?: boolean;
  /** CHAT: pose «a pensar» (inclina + bolha de pensamento). */
  thinking?: boolean;
  /** CHAT: aceno de boas-vindas ao abrir o widget (rotação ~2,8s). */
  wave?: boolean;
  /** CHAT: expressão — resultado de detectEmotion() (tint subtil). */
  emotion?: MascotEmotion;
  /** PAINEL: humor derivado dos dados do dashboard. */
  mood?: MascotMood;
  /** Chip flutuante (ex.: saudação personalizada) — home. */
  chipLabel?: string;
  /** Hero carrega eager (acima da dobra); resto lazy. */
  eager?: boolean;
  className?: string;
};

/* ── Ilustrações (PNG transparente + WebP optimizado) ── */
const SRC = {
  visitante: '/mascot/mascot-visitante',
  logado: '/mascot/mascot-logado',
  busto: '/mascot/mascot-busto',
} as const;

/** Tint subtil por emoção (só chat) — nunca muda a ilustração. */
const EMOTION_FILTER: Record<MascotEmotion, string> = {
  feliz: 'saturate(1.07)',
  preocupado: 'saturate(0.85) brightness(0.97)',
  pensativo: 'saturate(0.96)',
  neutro: 'saturate(1)',
};

export default function Mascot2p5D({
  context = 'home',
  isLoggedIn = false,
  speaking = false,
  thinking = false,
  wave = false,
  emotion = 'neutro',
  mood = 'neutral',
  chipLabel,
  eager = false,
  className = '',
}: Mascot2p5DProps) {
  const [failed, setFailed] = useState(false);

  const isChat = context === 'chat';
  const isDashboard = context === 'dashboard';
  const base = isChat || isDashboard ? SRC.busto : isLoggedIn ? SRC.logado : SRC.visitante;

  /* Sombra projectada no chão — tom adaptado ao fundo (claro no chat). */
  const shadowTone = isChat ? 'rgba(15, 23, 42, 0.30)' : 'rgba(2, 6, 23, 0.45)';

  /* Profundidade: drop-shadow segue a silhueta da ilustração. */
  const dropShadow =
    context === 'home'
      ? 'drop-shadow(0 22px 24px rgba(2, 6, 23, 0.38))'
      : 'drop-shadow(0 10px 12px rgba(15, 23, 42, 0.22))';

  /* Pose (rotação) — home acena continuamente; chat só cumprimenta/ pensa. */
  const poseClass = isChat
    ? thinking
      ? 'm2p5d-pose m2p5d-thinking'
      : wave
        ? 'm2p5d-pose m2p5d-wave'
        : 'm2p5d-pose'
    : context === 'home'
      ? 'm2p5d-pose m2p5d-rock'
      : 'm2p5d-pose';

  /* Halo atrás do personagem: separa a figura do fundo (2.5D). */
  const haloClass = isChat
    ? 'from-sky-400/25 via-blue-500/10 to-transparent'
    : 'from-blue-500/25 via-purple-500/10 to-transparent';

  const imgClass = ['m2p5d-img', speaking ? 'm2p5d-speaking' : ''].join(' ').trim();

  const alt =
    context === 'home'
      ? isLoggedIn
        ? 'Mascote da AngoStart — vendedor sorridente de barba com óculos e crachá'
        : 'Mascote da AngoStart — vendedor sorridente de barba a acenar'
      : 'Mascote da AngoStart — assistente de barba com óculos';

  return (
    <div
      className={`relative h-full w-full select-none ${className}`}
      aria-hidden={context !== 'chat'}
      role={isChat ? 'img' : undefined}
      aria-label={isChat ? alt : undefined}
    >
      {/* Halo radial (gradiente da marca) — profundidade sem WebGL */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-1/2 h-[92%] w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br ${haloClass} blur-2xl ${
          speaking ? 'm2p5d-halo' : ''
        }`}
      />

      {/* Sombra elíptica no chão — «respira» em contra-fase da flutuação */}
      <div
        aria-hidden="true"
        className="m2p5d-shadow pointer-events-none absolute bottom-[1.5%] left-1/2 h-[4.5%] w-[52%] -translate-x-1/2 rounded-[50%]"
        style={{ background: `radial-gradient(closest-side, ${shadowTone}, transparent 72%)` }}
      />

      {/* Camada de flutuação (translateY) */}
      <div className="m2p5d absolute inset-0 flex items-end justify-center">
        {/* Camada de pose (rotação/inclinação) + drop-shadow pela silhueta */}
        <div
          className={`${poseClass} relative flex h-full w-full items-end justify-center`}
          style={{
            filter: `${dropShadow} ${isChat ? EMOTION_FILTER[emotion] : ''}`.trim(),
            opacity: mood === 'alert' && isDashboard ? 0.92 : 1,
          }}
        >
          {failed ? (
            /* Fallback: ícone simples se a ilustração não carregar */
            <span
              className="mb-[8%] flex aspect-square h-[62%] items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg"
              aria-hidden="true"
            >
              <Bot className="h-[55%] w-[55%]" />
            </span>
          ) : (
            <picture className="m2p5d-picture">
              <source srcSet={`${base}.webp`} type="image/webp" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${base}.png`}
                alt={alt}
                loading={eager ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={eager ? 'high' : 'low'}
                draggable={false}
                className={imgClass}
                onError={() => setFailed(true)}
              />
            </picture>
          )}
        </div>
      </div>

      {/* Bolha de pensamento (chat — isTyping) */}
      {thinking && (
        <span
          aria-hidden="true"
          className="animate-float absolute -right-1 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-blue-200/60 bg-white/90 text-sm shadow-md backdrop-blur"
        >
          💭
        </span>
      )}

      {/* Chip de saudação personalizada (home logado / fallback) */}
      {chipLabel && (
        <div className="animate-float absolute left-0 top-4 z-10 flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:bg-slate-900/90">
          <span className="max-w-[9rem] truncate text-sm font-bold text-slate-800 dark:text-slate-100">
            {chipLabel}
          </span>
          <span className="text-base">👋</span>
        </div>
      )}
    </div>
  );
}
