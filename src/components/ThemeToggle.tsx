'use client';

/**
 * AngoStart — Alternador de tema claro/escuro (Fase 20).
 *
 * - O tema CLARO continua o padrão (nenhuma classe no <html>).
 * - Ao ativar, adiciona `.dark` ao <html> e persiste em
 *   localStorage('angostart-theme'). O script anti-FOUC no layout
 *   aplica a escolha antes da primeira pintura.
 * - Ícone roda suavemente entre sol/lua (transição transform).
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'angostart-theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* armazenamento indisponível — só nesta sessão */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={dark ? 'Tema claro' : 'Tema escuro'}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-gray-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white ${className}`}
    >
      {/* Sol/lua com rotação + escala — só anima depois de montado
          (evita mismatch de hidratação) */}
      <span
        className={`transition-transform duration-500 ${
          mounted ? 'rotate-0 scale-100' : 'rotate-90 scale-0'
        }`}
        style={{ transform: dark ? 'rotate(180deg)' : undefined }}
      >
        {dark ? (
          <Moon className="h-5 w-5" />
        ) : (
          <Sun className="h-5 w-5" />
        )}
      </span>
    </button>
  );
}
