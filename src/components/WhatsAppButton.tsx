'use client';

/**
 * AngoStart — Botão flutuante do WhatsApp (canto inferior direito).
 * Link direto para https://wa.me/244923456789
 */

import { MessageCircle } from 'lucide-react';

const WHATSAPP_URL =
  'https://wa.me/244923456789?text=' +
  encodeURIComponent('Olá! Vim do site AngoStart e gostaria de mais informações.');

export default function WhatsAppButton() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com a AngoStart no WhatsApp"
      className="group fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-xl shadow-emerald-900/30 transition-transform duration-300 hover:scale-110 hover:bg-[#1fb857] active:scale-95"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Anel pulsante */}
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-20" />
      <MessageCircle className="relative h-7 w-7" />
      <span className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 md:block">
        Fala connosco no WhatsApp
      </span>
    </a>
  );
}
