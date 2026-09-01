'use client';

/**
 * AngoStart — Transição de página (Fase 18).
 *
 * `template.tsx` remonta em cada navegação do App Router → fade suave
 * de entrada em todas as rotas. Apenas opacity (composição GPU).
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
