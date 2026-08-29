'use client';

/**
 * AngoStart — Registo do Service Worker (Fase 6, ponto 10 — PWA).
 * Regista /sw.js uma única vez no cliente; falha silenciosa (a app
 * continua a funcionar mesmo sem SW, ex.: browsers antigos).
 */

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((error) => {
          console.warn('[PWA] Service Worker não registado:', error);
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
