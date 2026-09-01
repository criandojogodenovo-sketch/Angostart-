'use client';

/**
 * AngoStart — CTAs contextuais da Home por sessão (Fase 19b).
 *
 * As secções de baixo da home («Quem pode vender» e CTA final) tinham CTAs
 * de registo fixos — mesmo para utilizadores com sessão. Agora:
 * - Visitante → CTAs de sempre (registo/comprar).
 * - Vendedor logado → 'Ir para o painel' + 'Publicar produto'.
 * - Cliente logado → 'Continuar a comprar' + 'Ver encomendas'.
 *
 * Enquanto a sessão é restaurada (`loading`) mostra a variante de visitante —
 * igual ao HTML server-renderizado, sem flash nem deslocação de layout.
 * Só apresentação: nenhuma lógica de negócio.
 */

import Link from 'next/link';
import {
  ArrowRight,
  FilePlus2,
  LayoutDashboard,
  Package,
  UserRoundPlus,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

type HomeProfile = 'visitante' | 'vendedor' | 'cliente';

function useHomeProfile(): HomeProfile {
  const { user, loading, isSeller } = useAuth();
  if (loading) return 'visitante';
  if (!user) return 'visitante';
  return isSeller ? 'vendedor' : 'cliente';
}

/* Botões por perfil: [primário, secundário] — null = variante visitante trata */
function ctasFor(
  profile: HomeProfile
): { primary: { href: string; label: string; icon: typeof Package | null }; secondary: { href: string; label: string; icon: typeof Package | null } } | null {
  if (profile === 'vendedor') {
    return {
      primary: { href: '/dashboard/vendedor', label: 'Ir para o painel', icon: LayoutDashboard },
      secondary: { href: '/adicionar-produto', label: 'Publicar produto', icon: FilePlus2 },
    };
  }
  if (profile === 'cliente') {
    return {
      primary: { href: '/produtos', label: 'Continuar a comprar', icon: null },
      secondary: { href: '/perfil', label: 'Ver encomendas', icon: Package },
    };
  }
  return null;
}

/* ─────────────── Secção «Quem pode vender» (fundo claro) ─────────────── */

export function SellerTypesCta() {
  const profile = useHomeProfile();
  const logged = ctasFor(profile);

  if (!logged) {
    /* Visitante — CTA de registo atual */
    return (
      <>
        <Link
          href="/perfil"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110"
        >
          Quero vender como…
          <ArrowRight className="ml-2 h-5 w-5" />
        </Link>
        <p className="mt-3 text-xs text-slate-400">
          Registo gratuito · Publica infoprodutos, produtos físicos ou serviços
        </p>
      </>
    );
  }

  const PIcon = logged.primary.icon;
  const SIcon = logged.secondary.icon;
  return (
    <div className="flex flex-col justify-center gap-3 sm:flex-row">
      <Link
        href={logged.primary.href}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110"
      >
        {PIcon && <PIcon className="mr-2 h-5 w-5" />}
        {logged.primary.label}
        {profile === 'cliente' && <ArrowRight className="ml-2 h-5 w-5" />}
      </Link>
      <Link
        href={logged.secondary.href}
        className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
      >
        {SIcon && <SIcon className="mr-2 h-5 w-5" />}
        {logged.secondary.label}
      </Link>
    </div>
  );
}

/* ─────────────── CTA final (fundo escuro, dentro da caixa) ─────────────── */

export function FinalCta() {
  const profile = useHomeProfile();
  const logged = ctasFor(profile);

  if (!logged) {
    /* Visitante — CTAs atuais */
    return (
      <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Link
          href="/produtos"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110"
        >
          Começar a comprar
        </Link>
        <Link
          href="/perfil"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 px-8 font-semibold text-white transition-colors hover:bg-white/10"
        >
          <UserRoundPlus className="mr-2 h-5 w-5" />
          Criar o meu perfil
        </Link>
      </div>
    );
  }

  const PIcon = logged.primary.icon;
  const SIcon = logged.secondary.icon;
  return (
    <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
      <Link
        href={logged.primary.href}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110"
      >
        {PIcon && <PIcon className="mr-2 h-5 w-5" />}
        {logged.primary.label}
        <ArrowRight className="ml-2 h-5 w-5" />
      </Link>
      <Link
        href={logged.secondary.href}
        className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 px-8 font-semibold text-white transition-colors hover:bg-white/10"
      >
        {SIcon && <SIcon className="mr-2 h-5 w-5" />}
        {logged.secondary.label}
      </Link>
    </div>
  );
}
