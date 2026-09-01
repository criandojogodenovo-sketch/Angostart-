'use client';

/**
 * AngoStart — Kit de animações premium (Fase 18).
 *
 * - FadeIn: entrada suave (opacity + translateY) quando o elemento entra no viewport.
 * - AnimatedStat: contagem animada (0 → valor) com spring, dispara ao entrar no viewport.
 * - GradientSpinner: spinner com gradiente azul→roxo.
 * - AnimatedBar: barra de progresso que cresce de 0 até a largura indicada.
 *
 * Performance: apenas `transform` e `opacity` na animação contínua; a largura
 * da AnimatedBar é definida uma única vez na entrada (sem loop).
 */

import { useEffect, useId, useRef } from 'react';
import { motion, useInView, useMotionValue, useSpring } from 'framer-motion';
import type { ReactNode } from 'react';

type FadeInProps = {
  children: ReactNode;
  /** Atraso em segundos (para efeito cascata em grids). */
  delay?: number;
  /** Deslocamento vertical inicial (px). */
  y?: number;
  className?: string;
};

export function FadeIn({ children, delay = 0, y = 24, className }: FadeInProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  );
}

type AnimatedStatProps = {
  /** Valor final (numérico). */
  value: number;
  /** Formatação opcional (ex.: formatKz). Por defeito: inteiro pt-AO. */
  format?: (n: number) => string;
  className?: string;
};

export function AnimatedStat({ value, format, className }: AnimatedStatProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 42, stiffness: 80 });

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  useEffect(
    () =>
      spring.on('change', (v) => {
        if (ref.current) {
          ref.current.textContent = format
            ? format(v)
            : Math.round(v).toLocaleString('pt-AO');
        }
      }),
    [spring, format],
  );

  return (
    <span ref={ref} className={className}>
      {format ? format(0) : '0'}
    </span>
  );
}

export function GradientSpinner({ className = 'h-8 w-8' }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 50 50"
      role="status"
      aria-label="A carregar"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="88 44"
      />
    </svg>
  );
}

type AnimatedBarProps = {
  /** Largura final em % (0–100). */
  pct: number;
  className?: string;
  barClassName?: string;
  delay?: number;
};

/** Barra de progresso que cresce ao entrar no viewport. */
export function AnimatedBar({ pct, className, barClassName, delay = 0.15 }: AnimatedBarProps) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div className={`overflow-hidden ${className ?? ''}`}>
      <motion.div
        className={`h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 ${barClassName ?? ''}`}
        initial={{ width: '0%' }}
        whileInView={{ width: `${safe}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, delay, ease: 'easeOut' }}
      />
    </div>
  );
}
