'use client';

/**
 * AngoStart — DashboardMascot (painel de vendas · mascote 2.5D).
 *
 * Versão PEQUENA da mascote 2.5D (ilustração premium + CSS), fixa no
 * canto inferior direito do painel do vendedor (/dashboard/vendedor),
 * a flutuar suavemente e a REAGIR AOS DADOS:
 *
 *   mood 'positive' → chip verde «A vender!» (ilustração normal);
 *   mood 'alert'    → chip rosado + leve dessaturação (empatia);
 *   mood 'neutral'  → chip azul «À espera de vendas».
 *
 * Performance: 100% CSS/HTML (SEM WebGL) — <picture> WebP/PNG de ~30KB
 * (miniatura dedicada do busto), lazy loading, sombra/halo/ flutuação
 * em keyframes GPU. Zero JS de runtime, zero CLS.
 *
 * `pointer-events-none` + `aria-hidden` → NUNCA bloqueia cliques nem
 * leitores de ecrã; posicionado ACIMA dos botões flutuantes existentes
 * (WhatsApp/BackToTop estão a right-4 bottom-24/5 — ver posição abaixo).
 */

import { motion } from 'framer-motion';
import Mascot2p5D from '@/components/mascot/Mascot2p5D';
import type { MascotMood } from '@/components/mascot/Mascot2p5D';

type DashboardMascotProps = {
  /** Humor derivado dos cartões REAIS do dashboard (nunca inventado). */
  mood?: MascotMood;
  /** Etiqueta curta do chip (estado real do negócio). */
  label?: string;
};

const MOOD_CHIP: Record<MascotMood, { dot: string; fallback: string }> = {
  positive: { dot: 'bg-emerald-400', fallback: 'A vender!' },
  alert: { dot: 'bg-rose-400', fallback: 'Ver alertas' },
  neutral: { dot: 'bg-sky-400', fallback: 'À espera de vendas' },
};

export default function DashboardMascot({ mood = 'neutral', label }: DashboardMascotProps) {
  const chip = MOOD_CHIP[mood];

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-[11rem] right-4 z-30 flex select-none flex-col items-center sm:bottom-24 sm:right-6"
      initial={{ opacity: 0, scale: 0.8, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.4, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      <div className="h-[104px] w-[88px] sm:h-[124px] sm:w-[104px]">
        <Mascot2p5D context="dashboard" mood={mood} />
      </div>
      {/* Chip de estado (dados reais — sem valores inventados) */}
      <span
        className={`mt-0.5 flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/85 px-2.5 py-1 text-[10px] font-semibold text-slate-200 shadow-lg backdrop-blur transition-colors ${
          mood === 'alert' ? 'border-rose-500/40' : mood === 'positive' ? 'border-emerald-500/40' : 'border-sky-500/30'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
        {label ?? chip.fallback}
      </span>
    </motion.div>
  );
}
