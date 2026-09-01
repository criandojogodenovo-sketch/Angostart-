/**
 * AngoStart — Ilustração "Painel de vendas" (Fase 19, hero do vendedor).
 *
 * Mini-dashboard em glassmorphism com barras que crescem (gradiente azul→roxo),
 * linha de tendência teal e chips flutuantes (tendência, pagamento, nova venda).
 * Animações 100% CSS (transform/opacity) — server component, sem estado.
 */

import { ArrowUpRight, Coins, Store, TrendingUp } from 'lucide-react';

const BARS: { h: number; delay: string; tone: 'blue' | 'purple' | 'teal' }[] = [
  { h: 34, delay: '0.1s', tone: 'blue' },
  { h: 52, delay: '0.2s', tone: 'purple' },
  { h: 44, delay: '0.3s', tone: 'blue' },
  { h: 66, delay: '0.4s', tone: 'purple' },
  { h: 58, delay: '0.5s', tone: 'blue' },
  { h: 84, delay: '0.6s', tone: 'purple' },
];

const BAR_TONES: Record<'blue' | 'purple' | 'teal', string> = {
  blue: 'bg-gradient-to-t from-blue-600 to-blue-400',
  purple: 'bg-gradient-to-t from-purple-600 to-purple-400',
  teal: 'bg-gradient-to-t from-teal-500 to-teal-300',
};

export default function SalesChartIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto hidden h-[420px] w-[420px] select-none lg:block xl:h-[460px] xl:w-[460px]"
    >
      {/* Halos suaves de fundo */}
      <div className="absolute inset-8 rounded-full bg-blue-500/15 blur-3xl" />
      <div className="absolute bottom-4 right-10 h-40 w-40 rounded-full bg-purple-500/20 blur-3xl" />

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
        <circle cx="100" cy="14" r="3" fill="#8b5cf6" />
        <circle cx="186" cy="100" r="2.4" fill="#14b8a6" />
        <circle cx="100" cy="186" r="2.4" fill="#3b82f6" />
      </svg>

      {/* Mini-dashboard em vidro (centro) */}
      <div className="animate-float-slow absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
        {/* Cabeçalho do painel */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
              <Store className="h-4 w-4 text-white" />
            </span>
            <span className="text-xs font-semibold text-slate-200">
            As minhas vendas
            </span>
          </div>
          <span className="flex items-center gap-0.5 rounded-full bg-teal-500/20 px-2 py-0.5 text-[11px] font-bold text-teal-200">
            <ArrowUpRight className="h-3 w-3" />
            24%
          </span>
        </div>

        {/* Barras que crescem + linha de tendência */}
        <div className="relative mt-5 flex h-24 items-end justify-between gap-2">
          {BARS.map((b, i) => (
            <span
              key={i}
              style={{ height: `${b.h}%`, animationDelay: b.delay }}
              className={`animate-grow w-full rounded-t-lg ${BAR_TONES[b.tone]}`}
            />
          ))}
          {/* Linha de tendência teal (desenhada por cima das barras) */}
          <svg
            viewBox="0 0 200 96"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path
              d="M8 74 L40 60 L72 66 L104 42 L136 50 L168 22"
              fill="none"
              stroke="#2dd4bf"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="260"
              strokeDashoffset="260"
              className="animate-draw"
            />
            <circle cx="168" cy="22" r="5" fill="#2dd4bf" opacity="0.9" />
            <circle cx="168" cy="22" r="9" fill="#2dd4bf" opacity="0.25" />
          </svg>
        </div>

        {/* Rodapé do painel */}
        <div className="mt-4 flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Total este mês
            </span>
            <span className="block text-sm font-bold text-white">184 500 Kz</span>
          </div>
          <span className="flex h-7 items-center rounded-full bg-gradient-to-r from-blue-500 to-purple-500 px-3 text-[11px] font-semibold text-white shadow">
            Ver painel
          </span>
        </div>
      </div>

      {/* Chips flutuantes orbitando */}
      <div className="animate-float absolute left-2 top-10 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <TrendingUp className="h-7 w-7 text-blue-300" />
      </div>
      <div className="animate-float-delay absolute right-3 top-24 rounded-2xl border border-white/15 bg-white/10 p-3.5 shadow-xl backdrop-blur-xl">
        <Coins className="h-6 w-6 text-purple-300" />
      </div>

      {/* Chip de nova venda (check = sucesso → teal, coeso com a paleta) */}
      <div className="animate-float absolute -left-2 bottom-1/2 flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-3 py-1.5 shadow-xl backdrop-blur-xl [animation-delay:1.4s]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-500/20">
          <svg
            viewBox="0 0 12 12"
            className="h-3 w-3 fill-none stroke-teal-300"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6.5 4.5 9 10 3.5" />
          </svg>
        </span>
        <span className="text-[11px] font-semibold text-slate-200">
          Nova venda · +12 500 Kz
        </span>
      </div>

      {/* Chip de produto publicado */}
      <div className="animate-float-delay absolute bottom-6 right-10 flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-3 py-1.5 shadow-xl backdrop-blur-xl [animation-delay:0.8s]">
        <span className="h-2 w-2 rounded-full bg-blue-400" />
        <span className="text-[11px] font-semibold text-slate-200">
          Produto publicado
        </span>
      </div>
    </div>
  );
}
