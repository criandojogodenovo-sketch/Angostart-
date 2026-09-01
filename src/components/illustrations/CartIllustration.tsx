/**
 * AngoStart — Ilustração "Compras" (Fase 19, hero do cliente logado).
 *
 * Mini-carrinho em glassmorphism com artigos, total e botão de checkout,
 * cercado por chips flutuantes (produto, desconto, entrega em 48h) e anel
 * pontilhado. Animações 100% CSS (transform/opacity) — server component.
 */

import { Percent, ShoppingBag, ShoppingCart, Truck } from 'lucide-react';

const ITEMS: { tone: string; nameW: string; price: string }[] = [
  { tone: 'from-blue-500 to-teal-500', nameW: 'w-4/5', price: '8 500 Kz' },
  { tone: 'from-purple-500 to-blue-500', nameW: 'w-3/5', price: '4 000 Kz' },
];

export default function CartIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto hidden h-[420px] w-[420px] select-none lg:block xl:h-[460px] xl:w-[460px]"
    >
      {/* Halos suaves de fundo */}
      <div className="absolute inset-8 rounded-full bg-purple-500/15 blur-3xl" />
      <div className="absolute bottom-4 left-10 h-40 w-40 rounded-full bg-teal-500/15 blur-3xl" />

      {/* Anel pontilhado */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full animate-[spin_60s_linear_infinite] opacity-40"
      >
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
        <circle cx="100" cy="14" r="3" fill="#14b8a6" />
        <circle cx="186" cy="100" r="2.4" fill="#3b82f6" />
        <circle cx="100" cy="186" r="2.4" fill="#8b5cf6" />
      </svg>

      {/* Mini-carrinho em vidro (centro) */}
      <div className="animate-float-slow absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
              <ShoppingCart className="h-4 w-4 text-white" />
            </span>
            <span className="text-xs font-semibold text-slate-200">
              O teu carrinho
            </span>
          </div>
          <span className="rounded-full bg-blue-500/25 px-2 py-0.5 text-[11px] font-bold text-blue-100">
            2 artigos
          </span>
        </div>

        {/* Artigos */}
        <div className="mt-4 space-y-2.5">
          {ITEMS.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${item.tone} shadow-md`}
              >
                <ShoppingBag className="h-4 w-4 text-white" />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className={`h-2 rounded-full bg-white/50 ${item.nameW}`} />
                <div className="h-1.5 w-2/5 rounded-full bg-white/25" />
              </div>
              <span className="shrink-0 text-[10px] font-bold text-slate-300">
                {item.price}
              </span>
            </div>
          ))}
        </div>

        {/* Total + checkout */}
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3.5">
          <div className="space-y-1">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Total
            </span>
            <span className="block text-sm font-bold text-white">12 500 Kz</span>
          </div>
          <span className="flex h-7 items-center rounded-full bg-gradient-to-r from-blue-500 to-purple-500 px-3 text-[11px] font-semibold text-white shadow">
            Finalizar
          </span>
        </div>
      </div>

      {/* Chips flutuantes orbitando */}
      <div className="animate-float absolute left-2 top-10 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <ShoppingBag className="h-7 w-7 text-blue-300" />
      </div>
      <div className="animate-float-delay absolute right-3 top-24 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <Percent className="h-6 w-6 text-teal-300" />
      </div>
      <div className="animate-float absolute bottom-14 left-8 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl [animation-delay:2s]">
        <Truck className="h-6 w-6 text-purple-300" />
      </div>

      {/* Chip de entrega rápida */}
      <div className="animate-float absolute -right-2 bottom-1/2 flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-3 py-1.5 shadow-xl backdrop-blur-xl [animation-delay:1.4s]">
        <span className="h-2 w-2 rounded-full bg-teal-400" />
        <span className="text-[11px] font-semibold text-slate-200">
          Entrega em Luanda · 48h
        </span>
      </div>

      {/* Chip de pagamento em Kwanzas */}
      <div className="animate-float-delay absolute bottom-6 left-10 flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-3 py-1.5 shadow-xl backdrop-blur-xl [animation-delay:0.8s]">
        <span className="h-2 w-2 rounded-full bg-blue-400" />
        <span className="text-[11px] font-semibold text-slate-200">
          Pagamento em Kwanzas
        </span>
      </div>
    </div>
  );
}
