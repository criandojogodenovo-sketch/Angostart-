/**
 * AngoStart — «Como Funciona» compacto na Home (Fase 18).
 *
 * 3 passos com ícones e texto curto — substitui as longas explicações.
 * Server component estático.
 */

import { BadgeCheck, Search, UserRoundPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FadeIn } from '@/components/motion';

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: UserRoundPlus,
    title: 'Regista-te',
    text: 'Cria a tua conta gratuita em menos de 1 minuto — email ou telefone.',
  },
  {
    icon: Search,
    title: 'Escolhe o serviço',
    text: 'Explora o catálogo e fala direto com o vendedor pelo chat da plataforma.',
  },
  {
    icon: BadgeCheck,
    title: 'Paga e recebe',
    text: 'Paga em Kwanzas com segurança e confirma a entrega — só depois o vendedor recebe.',
  },
];

export default function HowItWorks() {
  return (
    <section aria-label="Como funciona" className="bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Como funciona
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 sm:text-base">
            Três passos simples — do registo à entrega.
          </p>
        </div>

        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <FadeIn key={title} delay={i * 0.08}>
              <li className="relative flex flex-col items-center text-center">
                {/* Conector entre passos (desktop) */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[calc(50%+3.5rem)] top-7 hidden w-[calc(100%-7rem)] border-t-2 border-dashed border-blue-200 md:block"
                  />
                )}
                <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/25">
                  <Icon className="h-6 w-6" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-teal-500 text-[11px] font-black text-white">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-3 text-base font-bold text-slate-900">{title}</h3>
                <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">{text}</p>
              </li>
            </FadeIn>
          ))}
        </ol>
      </div>
    </section>
  );
}
