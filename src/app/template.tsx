'use client';

/**
 * AngoStart — Transição de página (Fase 20).
 *
 * `template.tsx` remonta em cada navegação do App Router → entrada
 * fade + slide suave em todas as rotas. Apenas opacity/transform
 * (composição GPU), respeita prefers-reduced-motion via framer-motion.
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  );
}
