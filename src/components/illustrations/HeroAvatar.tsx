'use client';

/**
 * AngoStart — HeroAvatar (redesign real, ref. «Hello Josh»).
 *
 * Ilustração SVG de uma pessoa que acena — visível na home para TODOS os
 * estados de sessão (o boneco NUNCA desaparece após o login):
 *  - Visitante   → boneco SEM óculos (aceno contínuo);
 *  - Autenticado → o MESMO boneco COM óculos (estilo cool/moderno),
 *    com animações extra: piscar de olhos + ajustar os óculos.
 *
 * Tamanho MÉDIO equilibrado — não domina o conteúdo nem fica pequeno
 * demais: ≤270px no mobile (centrado, sem sair do ecrã) e ≤320px no
 * desktop (~1/3 da altura visual do hero, ao lado do texto).
 *
 * Animações 100% CSS (server-friendly) que respeitam
 * prefers-reduced-motion (ver globals.css):
 *  - .animate-wave-arm       → aceno do braço (todos os estados);
 *  - .animate-blink          → piscar de olhos (autenticado);
 *  - .animate-glasses-adjust → empurrar os óculos (autenticado).
 */

import { Sparkles } from 'lucide-react';

type HeroAvatarProps = {
  /** Autenticado → desenha óculos + animações extra (blink/ajuste). */
  withGlasses?: boolean;
  /** Texto do chip flutuante (ex.: primeiro nome do utilizador). */
  chipLabel?: string;
};

export default function HeroAvatar({
  withGlasses = false,
  chipLabel = 'Olá!',
}: HeroAvatarProps) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-[270px] select-none sm:max-w-[310px] lg:max-w-[320px]"
    >
      {/* Halo de gradiente atrás da pessoa + sombra suave no chão */}
      <div className="absolute inset-x-4 top-6 bottom-10 rounded-full bg-gradient-to-br from-blue-500/30 via-indigo-500/20 to-purple-500/30 blur-3xl" />

      {/* Chips flutuantes à volta da figura (ref. «Good Morning Josh») */}
      <div className="animate-float absolute -left-1 top-6 z-10 flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:bg-slate-900/90">
        <span className="max-w-[9rem] truncate text-sm font-bold text-slate-800 dark:text-slate-100">
          {chipLabel}
        </span>
        <span className="text-base">👋</span>
      </div>
      <div className="animate-float-delay absolute right-0 top-24 z-10 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/40">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="animate-float-slow absolute left-2 bottom-16 z-10 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-lg shadow-teal-500/40 [animation-delay:1.2s]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 7h12l1.5 12.5a1.6 1.6 0 0 1-1.6 1.5H6.1a1.6 1.6 0 0 1-1.6-1.5L6 7Z" />
          <path d="M9 10V6a3 3 0 0 1 6 0v4" />
        </svg>
      </div>

      {/* ── A pessoa (half-body, estilo 3D suave) ── */}
      <svg
        viewBox="0 0 320 340"
        className="relative h-auto w-full drop-shadow-[0_24px_40px_rgba(30,41,59,0.35)]"
        role="img"
      >
        <defs>
          <linearGradient id="ha-skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffd9b8" />
            <stop offset="100%" stopColor="#eda87c" />
          </linearGradient>
          <linearGradient id="ha-shirt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="ha-shirt-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6fe0" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <radialGradient id="ha-halo" cx="0.5" cy="0.42" r="0.6">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ha-lens" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* Círculo de fundo (anel pontilhado + halo) */}
        <circle cx="160" cy="150" r="130" fill="url(#ha-halo)" />
        <circle
          cx="160"
          cy="150"
          r="126"
          fill="none"
          stroke="rgba(148,163,184,0.5)"
          strokeWidth="1.5"
          strokeDasharray="4 9"
          strokeLinecap="round"
        />
        <circle cx="286" cy="150" r="4" fill="#8b5cf6" />
        <circle cx="34" cy="150" r="3" fill="#14b8a6" />
        <circle cx="160" cy="24" r="3" fill="#3b82f6" />

        {/* Sombra elíptica no chão */}
        <ellipse cx="160" cy="322" rx="86" ry="12" fill="rgba(15,23,42,0.35)" />

        {/* ── Braço esquerdo (apoiado) ── */}
        <path
          d="M108 200 Q84 226 92 268 L128 268 Q118 232 132 208 Z"
          fill="url(#ha-shirt-dark)"
        />
        <circle cx="96" cy="268" r="13" fill="url(#ha-skin)" />

        {/* ── Corpo (torso arredondado, camisola em gradiente) ── */}
        <path
          d="M110 178 Q160 150 210 178 L224 300 Q224 322 200 322 L120 322 Q96 322 96 300 Z"
          fill="url(#ha-shirt)"
        />
        {/* Gola */}
        <path d="M138 168 Q160 186 182 168 L174 158 Q160 170 146 158 Z" fill="#ffffff" opacity="0.9" />
        {/* Selo AngoStart no peito */}
        <circle cx="160" cy="228" r="26" fill="rgba(255,255,255,0.16)" />
        <path
          d="M148 228 l8 8 16 -16"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />

        {/* ── Braço direito ACENANDO (grupo animado, origem no ombro) ── */}
        <g className="animate-wave-arm" style={{ transformBox: 'fill-box', transformOrigin: '18% 88%' }}>
          {/* ombro→cotovelo */}
          <path
            d="M212 186 Q246 176 254 148 L232 116 Q218 146 196 158 Z"
            fill="url(#ha-shirt-dark)"
          />
          {/* antebraço levantado + mão aberta */}
          <path
            d="M232 116 Q236 84 226 62 L246 52 Q262 82 254 122 Z"
            fill="url(#ha-shirt-dark)"
          />
          {/* palma */}
          <g transform="translate(234 30)">
            <circle cx="10" cy="18" r="13" fill="url(#ha-skin)" />
            <rect x="-2" y="2" width="7" height="18" rx="3.5" fill="url(#ha-skin)" />
            <rect x="16" y="0" width="7" height="20" rx="3.5" fill="url(#ha-skin)" transform="rotate(14 19 10)" />
          </g>
        </g>

        {/* ── Cabeça ── */}
        {/* pescoço */}
        <rect x="146" y="132" width="28" height="26" rx="12" fill="url(#ha-skin)" />
        {/* rosto */}
        <circle cx="160" cy="96" r="44" fill="url(#ha-skin)" />
        {/* orelhas */}
        <circle cx="116" cy="98" r="8" fill="url(#ha-skin)" />
        <circle cx="204" cy="98" r="8" fill="url(#ha-skin)" />
        {/* cabelo */}
        <path
          d="M116 92 Q114 48 160 46 Q206 48 204 92 Q204 70 186 64 Q190 74 178 70 Q196 88 192 100 Q186 66 160 62 Q134 66 128 100 Q124 88 132 76 Q120 82 116 92 Z"
          fill="#312e4f"
        />
        {/* sobrancelhas + olhos + sorriso */}
        <path d="M136 88 q8 -6 16 0" fill="none" stroke="#312e4f" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M168 88 q8 -6 16 0" fill="none" stroke="#312e4f" strokeWidth="3.5" strokeLinecap="round" />
        <g className={withGlasses ? 'animate-blink' : undefined}>
          <circle cx="144" cy="98" r="4.5" fill="#312e4f" />
          <circle cx="176" cy="98" r="4.5" fill="#312e4f" />
          <circle cx="145.5" cy="96.5" r="1.4" fill="#ffffff" />
          <circle cx="177.5" cy="96.5" r="1.4" fill="#ffffff" />
        </g>
        <path d="M146 112 q14 12 28 0" fill="none" stroke="#b4562e" strokeWidth="4" strokeLinecap="round" />
        {/* bochechas */}
        <circle cx="132" cy="108" r="6" fill="#f1996b" opacity="0.55" />
        <circle cx="188" cy="108" r="6" fill="#f1996b" opacity="0.55" />

        {/* ── Óculos (estilo cool/moderno) — apenas com sessão iniciada.
            Lentes em gradiente azul, ponte arqueada, hastes até às orelhas
            e gloss diagonal; o grupo anima o gesto de «empurrar os óculos». ── */}
        {withGlasses && (
          <g className="animate-glasses-adjust">
            <path
              d="M133 93 Q124 90 118 96"
              fill="none"
              stroke="#312e4f"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M187 93 Q196 90 202 96"
              fill="none"
              stroke="#312e4f"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect
              x="131"
              y="85"
              width="26"
              height="26"
              rx="9"
              fill="url(#ha-lens)"
              stroke="#312e4f"
              strokeWidth="3"
            />
            <rect
              x="163"
              y="85"
              width="26"
              height="26"
              rx="9"
              fill="url(#ha-lens)"
              stroke="#312e4f"
              strokeWidth="3"
            />
            <path
              d="M157 93.5 Q160 90 163 93.5"
              fill="none"
              stroke="#312e4f"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M136 91 l6 -3.5"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.9"
            />
            <path
              d="M168 91 l6 -3.5"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.9"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
