/**
 * AngoStart — Ilustração decorativa do Hero (Fase 18).
 *
 * Composição de ícones flutuantes (carrinho, loja, carteira, chat) em chips de
 * vidro à volta de um mini-card de produto em glassmorphism, sobre um anel SVG
 * pontilhado. Animações 100% CSS (transform/opacity) — sem JS, sem estado.
 *
 * Server component: apenas marcação + classes utilitárias.
 */

import { MessageCircle, ShoppingBag, Store, Wallet } from 'lucide-react';

export default function HeroIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto hidden h-[420px] w-[420px] select-none lg:block xl:h-[460px] xl:w-[460px]">
      {/* Halo suave de fundo */}
      <div className="absolute inset-8 rounded-full bg-blue-500/15 blur-3xl" />
      <div className="absolute bottom-4 right-10 h-40 w-40 rounded-full bg-purple-500/20 blur-3xl" />

      {/* Anel pontilhado */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-[spin_60s_linear_infinite] opacity-40">
        <circle
          cx="100"
          cy="100"
          r="86"
          fill="none"
          stroke="rgba(148,163,184,0.45)"
          strokeWidth="1"
          strokeDasharray="3 7"
          strokeLinecap="round"
        />
        <circle cx="100" cy="14" r="3" fill="#3b82f6" />
        <circle cx="186" cy="100" r="2.4" fill="#8b5cf6" />
        <circle cx="100" cy="186" r="2.4" fill="#14b8a6" />
      </svg>

      {/* Mini-card de produto em vidro (centro) */}
      <div className="animate-float-slow absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
            <ShoppingBag className="h-6 w-6 text-white" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2.5 w-4/5 rounded-full bg-white/50" />
            <div className="h-2 w-3/5 rounded-full bg-white/25" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="rounded-full bg-blue-500/25 px-2.5 py-1 text-[11px] font-bold text-blue-100">
            12 500 Kz
          </span>
          <span className="flex h-7 items-center rounded-full bg-gradient-to-r from-blue-500 to-purple-500 px-3 text-[11px] font-semibold text-white shadow">
            Comprar
          </span>
        </div>
        <div className="mt-3 flex gap-1.5">
          <span className="h-1.5 w-8 rounded-full bg-purple-400/70" />
          <span className="h-1.5 w-5 rounded-full bg-blue-400/70" />
          <span className="h-1.5 w-5 rounded-full bg-teal-400/70" />
        </div>
      </div>

      {/* Ícones flutuantes orbitando */}
      <div className="animate-float absolute left-2 top-10 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <Store className="h-7 w-7 text-blue-300" />
      </div>
      <div className="animate-float-delay absolute right-3 top-24 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <MessageCircle className="h-6 w-6 text-purple-300" />
      </div>
      <div className="animate-float absolute bottom-14 left-8 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl [animation-delay:2s]">
        <Wallet className="h-6 w-6 text-teal-300" />
      </div>
      <div className="animate-float-delay absolute bottom-6 right-12 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl [animation-delay:0.8s]">
        <ShoppingBag className="h-6 w-6 text-blue-200" />
      </div>

      {/* Chip de venda concluída */}
      <div className="animate-float absolute -left-2 bottom-1/2 flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-3 py-1.5 shadow-xl backdrop-blur-xl [animation-delay:1.4s]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-500/20">
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-teal-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6.5 4.5 9 10 3.5" />
          </svg>
        </span>
        <span className="text-[11px] font-semibold text-slate-200">Venda concluída</span>
      </div>
    </div>
  );
}
