'use client';

/**
 * AngoStart — Botão «Voltar ao topo» (Fase 16, otimização de navegação).
 *
 * Flutuante, canto inferior direito, aparece após 400 px de scroll.
 * Suave (behavior: smooth) e acessível (aria-label, teclado).
 */

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export default function BackToTop({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Voltar ao topo"
      className="fixed bottom-24 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/30 transition-all hover:scale-105 hover:shadow-xl active:scale-95 sm:bottom-6"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
