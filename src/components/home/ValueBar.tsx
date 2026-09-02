/**
 * AngoStart — Barra de Valor da Home (Fase 18).
 *
 * Faixa fina horizontal logo abaixo do Hero com os 4 benefícios-chave.
 * Server component estático — zero JS, zero pedidos.
 */

import { Banknote, Headset, ShieldCheck, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const VALUES: { icon: LucideIcon; label: string; hint: string; tone: string }[] = [
  {
    icon: Banknote,
    label: 'Pagamento em Kwanza',
    hint: 'KWiK, transferência ou dinheiro',
    tone: 'text-blue-600 bg-blue-100/80',
  },
  {
    icon: Truck,
    label: 'Entrega em Luanda',
    hint: 'Ao domicílio em até 48h',
    tone: 'text-purple-600 bg-purple-100/80',
  },
  {
    icon: ShieldCheck,
    label: 'Profissionais Verificados',
    hint: 'KYC e avaliações reais',
    tone: 'text-teal-600 bg-teal-100/80',
  },
  {
    icon: Headset,
    label: 'Suporte por WhatsApp',
    hint: 'Seg–Sáb, das 08h às 18h',
    tone: 'text-blue-600 bg-blue-100/80',
  },
];

export default function ValueBar() {
  return (
    <section aria-label="Benefícios da AngoStart" className="border-y border-blue-100/80 bg-white/70 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-3 py-4 lg:grid-cols-4">
          {VALUES.map(({ icon: Icon, label, hint, tone }) => (
            <li key={label} className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-800 sm:text-sm">
                  {label}
                </span>
                <span className="hidden truncate text-[11px] text-slate-500 sm:block">
                  {hint}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
