'use client';

/**
 * AngoStart — Hero personalizado por sessão (Fase 19 · redesign real).
 *
 * Estrutura «Hello Josh»: grelha de 2 colunas — texto à esquerda,
 * FIGURA à direita: o HeroAvatar (boneco) aparece SEMPRE — visitante
 * SEM óculos; autenticado COM óculos + blink + gesto de ajustar os
 * óculos. No mobile a figura fica CENTRADA por baixo do texto, sem
 * sair do ecrã (max-w-full + grid).
 *
 * Lê o AuthContext e renderiza o hero em 3 variantes (texto/CTAs):
 * - Visitante (não logado): saudação neutra + CTAs de registo.
 * - Vendedor logado: saudação por horário com nome + CTAs de painel.
 * - Cliente logado: saudação por horário com nome + CTAs de compra.
 *
 * Enquanto a sessão é restaurada (`loading`), mostra a variante de visitante —
 * igual ao HTML server-renderizado, sem flash nem salto de layout.
 *
 * Só apresentação: nenhuma lógica de negócio — apenas CTAs e ilustrações.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  FilePlus2,
  LayoutDashboard,
  Package,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/lib/roles';
import type { Role } from '@/lib/roles';
import HeroAvatar from '@/components/illustrations/HeroAvatar';
import PatternWaves from '@/components/illustrations/PatternWaves';

type HeroVariant = 'visitante' | 'vendedor' | 'cliente';

type CtaIcon = React.ComponentType<{ className?: string }> | null;

type Greeting = 'Bom dia' | 'Boa tarde' | 'Boa noite' | 'Olá';

/** Período do dia a partir da hora local (hidratação segura: só no cliente). */
function greetingForHour(hour: number): Greeting {
  if (hour >= 6 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  if (hour >= 18 || hour < 6) return 'Boa noite';
  return 'Olá';
}

const GREETING_ICON: Record<Greeting, string> = {
  'Bom dia': '☀️',
  'Boa tarde': '🌤️',
  'Boa noite': '🌙',
  Olá: '👋',
};

/** Hook partilhado do hero: saudação calculada só depois de montar. */
function useGreeting(): { greeting: Greeting; mounted: boolean } {
  const [greeting, setGreeting] = useState<Greeting>('Olá');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
    setMounted(true);
  }, []);
  return { greeting, mounted };
}

const PRIMARY_CTA =
  'btn-shine inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:shadow-xl hover:brightness-110 active:scale-95';

const SECONDARY_CTA =
  'inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-8 text-base font-semibold text-white backdrop-blur transition-all hover:bg-white/10 hover:scale-[1.02] active:scale-95';

export default function PersonalizedHero() {
  const { user, loading, isSeller } = useAuth();

  const variant: HeroVariant = loading
    ? 'visitante'
    : user
      ? isSeller
        ? 'vendedor'
        : 'cliente'
      : 'visitante';

  const roleLabel = user ? ROLE_LABELS[user.role as Role] ?? 'Cliente' : null;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950 text-white">
      {/* Brilhos decorativos + padrão de ondas (Fase 18) */}
      <PatternWaves className="opacity-70" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-purple-500/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        {/* Grelha estrutural: min-w-0 impede overflow do texto; a figura
            centra-se por baixo no mobile e sobe ao lado no desktop. */}
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-6">
          <motion.div
            key={variant}
            className="min-w-0"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            {variant === 'visitante' && <HeroVisitante />}
            {variant === 'vendedor' && (
              <HeroLogado
                title="Pronto para gerir as tuas vendas?"
                description={
                  'O teu painel mostra encomendas, pagamentos KWiK e o catálogo em tempo real. Publica novos produtos e acompanha cada venda em Kwanzas.'
                }
                badgeLabel={roleLabel ?? 'Vendedor'}
                primary={{
                  href: '/dashboard/vendedor',
                  label: 'Ir para o painel',
                  icon: LayoutDashboard,
                }}
                secondary={{
                  href: '/adicionar-produto',
                  label: 'Publicar produto',
                  icon: FilePlus2,
                }}
              />
            )}
            {variant === 'cliente' && (
              <HeroLogado
                title="Que produto procuras hoje?"
                description={
                  'Explora infoprodutos, produtos físicos e serviços verificados. Recebe em Luanda em até 48 horas e paga em Kwanzas, sem complicações.'
                }
                badgeLabel={roleLabel ?? 'Cliente'}
                primary={{
                  href: '/produtos',
                  label: 'Continuar a comprar',
                  icon: null,
                }}
                secondary={{
                  href: '/perfil',
                  label: 'Ver encomendas',
                  icon: Package,
                }}
              />
            )}
          </motion.div>

          {/* ── Figura (ref. «Hello Josh») — o boneco aparece SEMPRE:
              visitante sem óculos; autenticado com óculos estilo cool,
              piscar de olhos e gesto de ajustar os óculos ── */}
          <motion.div
            key={`fig-${variant}`}
            className="flex min-w-0 justify-center lg:justify-end"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            <HeroAvatar
              withGlasses={variant !== 'visitante'}
              chipLabel={
                variant === 'visitante' || !firstName
                  ? 'Olá!'
                  : `${firstName}!`
              }
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Saudação (eyebrow) ─────────────── */

function GreetingEyebrow() {
  const { greeting, mounted } = useGreeting();
  return (
    <p className="flex items-center gap-2 text-lg font-bold text-blue-300 sm:text-xl">
      <span aria-hidden="true" className="animate-wave text-2xl [animation:none]">
        {mounted ? GREETING_ICON[greeting] : '👋'}
      </span>
      {mounted ? greeting : 'Olá'}
      <span aria-hidden="true">!</span>
    </p>
  );
}

/* ─────────────── Variante visitante ─────────────── */

function HeroVisitante() {
  return (
    <>
      <GreetingEyebrow />

      <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-400">
        <BadgeCheck className="h-4 w-4" />
        100% angolana · Luanda
      </span>

      <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
        Ango<span className="text-blue-400">Start</span>: tudo o que o teu
        negócio precisa, num só lugar
      </h1>

      <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
        Compra infoprodutos, produtos físicos e contrata serviços ao domicílio
        ou remotos com preços claros em Kwanzas. Uma plataforma criada em
        Angola, pensada para empreendedores, famílias e empresas que querem
        resultados sem complicações.
      </p>

      <div className="mt-8 flex max-w-full flex-col gap-3 sm:flex-row">
        <Link href="/perfil" className={PRIMARY_CTA}>
          Quero vender
          <ArrowRight className="ml-2 h-5 w-5" />
        </Link>
        <Link href="/perfil" className={SECONDARY_CTA}>
          Criar perfil
        </Link>
      </div>

      {/* Estatísticas */}
      <dl className="mt-12 grid max-w-xl grid-cols-3 gap-6">
        {[
          { value: '4', label: 'Categorias de produtos e serviços' },
          { value: '3', label: 'Formas de vender no marketplace' },
          { value: '48h', label: 'Entrega em Luanda' },
        ].map(({ value, label }) => (
          <div key={label} className="min-w-0">
            <dt className="sr-only">{label}</dt>
            <dd className="text-2xl font-bold text-blue-400 sm:text-3xl">
              {value}
            </dd>
            <dd className="mt-1 text-xs text-slate-400 sm:text-sm">{label}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/* ─────────────── Variante logada (vendedor / cliente) ─────────────── */

type HeroLogadoProps = {
  title: string;
  description: string;
  badgeLabel: string;
  primary: { href: string; label: string; icon: CtaIcon };
  secondary: { href: string; label: string; icon: CtaIcon };
};

function HeroLogado({
  title,
  description,
  badgeLabel,
  primary,
  secondary,
}: HeroLogadoProps) {
  const { user } = useAuth();
  const { greeting, mounted } = useGreeting();
  const PrimaryIcon = primary.icon;
  const SecondaryIcon = secondary.icon;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';

  return (
    <>
      {/* Saudação por horário com o nome real (substitui a bolha pequena) */}
      <p className="flex flex-wrap items-center gap-2 text-lg font-bold text-blue-300 sm:text-xl">
        <span aria-hidden="true" className="text-2xl">
          {mounted ? GREETING_ICON[greeting] : '👋'}
        </span>
        {mounted ? greeting : 'Olá'}
        {firstName ? `, ${firstName}!` : '!'}
      </p>

      <span className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-teal-300">
        <BadgeCheck className="h-4 w-4" />
        Sessão iniciada · {badgeLabel}
      </span>

      <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
        <span className="text-gradient-animated">{title}</span>
      </h1>

      <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
        {description}
      </p>

      <div className="mt-8 flex max-w-full flex-col gap-3 sm:flex-row">
        <Link href={primary.href} className={PRIMARY_CTA}>
          {PrimaryIcon && <PrimaryIcon className="mr-2 h-5 w-5" />}
          {primary.label}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Link>
        <Link href={secondary.href} className={SECONDARY_CTA}>
          {SecondaryIcon && <SecondaryIcon className="mr-2 h-5 w-5" />}
          {secondary.label}
        </Link>
      </div>
    </>
  );
}
