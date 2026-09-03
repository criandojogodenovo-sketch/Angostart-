'use client';

/**
 * AngoStart — Hero personalizado por sessão (Fase 19).
 *
 * Lê o AuthContext e renderiza o hero em 3 variantes:
 * - Visitante (não logado): CTAs de registo ('Quero vender' / 'Criar perfil').
 * - Vendedor logado: saudação + ilustração de painel de vendas +
 *   CTAs 'Ir para o painel' / 'Publicar produto'.
 * - Cliente logado: saudação + ilustração de carrinho +
 *   CTAs 'Continuar a comprar' / 'Ver encomendas'.
 *
 * Enquanto a sessão é restaurada (`loading`), mostra a variante de visitante —
 * igual ao HTML server-renderizado, sem flash nem salto de layout. A troca de
 * variante é uma entrada suave (opacity + translateY, framer-motion).
 *
 * Só apresentação: nenhuma lógica de negócio — apenas CTAs e ilustrações.
 */

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
import GreetingAvatar from '@/components/GreetingAvatar';
import HeroIllustration from '@/components/illustrations/HeroIllustration';
import SalesChartIllustration from '@/components/illustrations/SalesChartIllustration';
import CartIllustration from '@/components/illustrations/CartIllustration';
import PatternWaves from '@/components/illustrations/PatternWaves';

type HeroVariant = 'visitante' | 'vendedor' | 'cliente';

type CtaIcon = React.ComponentType<{ className?: string }> | null;

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

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
        <div className="flex items-center gap-8">
          <motion.div
            key={variant}
            className="max-w-3xl flex-1"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            {variant === 'visitante' && <HeroVisitante />}
            {variant === 'vendedor' && (
              <HeroLogado
                /* Fase 20: avatar interativo com saudação por horário
                   (Bom dia/Boa tarde/Boa noite) substitui o «Olá, X! 👋». */
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

          {/* Ilustração — cada variante traz a sua (escondida em <lg, como no hero original) */}
          {variant === 'visitante' && <HeroIllustration />}
          {variant === 'vendedor' && <SalesChartIllustration />}
          {variant === 'cliente' && <CartIllustration />}
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Variante visitante ─────────────── */

function HeroVisitante() {
  return (
    <>
      {/* Avatar interativo com saudação por horário — também para visitantes
          (ref. «Hello Josh / Good Morning»: a home cumprimenta SEMPRE).
          flex w-fit força linha própria (o badge fica por baixo) e pl-10
          contém os tiles flutuantes dentro do cartão. */}
      <div className="mb-6 flex w-fit rounded-2xl border border-white/10 bg-white/5 p-3 pl-10 backdrop-blur">
        <GreetingAvatar variant="hero" />
      </div>

      <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-400">
        <BadgeCheck className="h-4 w-4" />
        100% angolana · Luanda
      </span>

      <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
        Ango<span className="text-blue-400">Start</span>: tudo o que o teu
        negócio precisa, num só lugar
      </h1>

      <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
        Compra infoprodutos, produtos físicos e contrata serviços ao domicílio
        ou remotos com preços claros em Kwanzas. Uma plataforma criada em
        Angola, pensada para empreendedores, famílias e empresas que querem
        resultados sem complicações.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
          <div key={label}>
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
  const PrimaryIcon = primary.icon;
  const SecondaryIcon = secondary.icon;
  return (
    <>
      {/* Avatar/boneco interativo com saudação por horário (Fase 20) */}
      <div className="mb-4 flex w-fit rounded-2xl border border-white/10 bg-white/5 p-3 pl-10 backdrop-blur">
        <GreetingAvatar variant="hero" />
      </div>

      <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-teal-300">
        <BadgeCheck className="h-4 w-4" />
        Sessão iniciada · {badgeLabel}
      </span>

      <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
        <span className="text-gradient-animated">{title}</span>
      </h1>

      <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
        {description}
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
