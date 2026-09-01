'use client';

/**
 * AngoStart — Barra de navegação inferior para MOBILE (Fase 6, ponto 4).
 *
 * Fase 16 (redesign): pílula flutuante com fundo escuro premium, cantos
 * arredondados e margem lateral — o conteúdo passa por baixo (body com
 * padding calculado). Novo item «IA» que abre o assistente (evento global
 * 'angostart:ai-open' ouvido pelo SupportChatWidget).
 *
 * - Visível apenas em ecrãs pequenos (md:hidden).
 * - Itens: Início, Produtos, Pesquisar (overlay), IA, Carrinho, Perfil.
 * - Ícones grandes (44px+ de alvo tátil), sombra elevada.
 * - Respeita a safe area do iOS (env(safe-area-inset-bottom)).
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Package, Search, ShoppingBag, Sparkles, User, X } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import { useCart } from '@/context/StoreContext';
import { AI_CHAT_OPEN_EVENT } from '@/components/SupportChatWidget';

const ITEMS = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/produtos', label: 'Produtos', icon: Package },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const { count } = useCart();
  const [searchOpen, setSearchOpen] = useState(false);

  const navLink = (href: string, label: string, Icon: typeof Home, badge?: number) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setSearchOpen(false)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 transition-colors ${
          active ? 'text-blue-400' : 'text-slate-300 active:bg-white/10'
        }`}
      >
        <span className="relative">
          <Icon className="h-6 w-6" aria-hidden="true" />
          {badge !== undefined && badge > 0 && (
            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </span>
        <span className="text-[10px] font-semibold">{label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Overlay de pesquisa (Fase 6, ponto 4 — item "Pesquisar") */}
      <div
        className={`fixed inset-x-0 top-0 z-[80] bg-slate-900/95 p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-2xl backdrop-blur transition-transform duration-300 md:hidden ${
          searchOpen ? 'translate-y-0' : '-translate-y-full'
        }`}
        role="dialog"
        aria-label="Pesquisar produtos e serviços"
        aria-hidden={!searchOpen}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1">
            {searchOpen && <SearchBar onSearched={() => setSearchOpen(false)} />}
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label="Fechar pesquisa"
            className="rounded-full p-2.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Pílula flutuante (Fase 16) */}
      <nav
        aria-label="Navegação principal (mobile)"
        className="fixed inset-x-3 bottom-3 z-[75] md:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-0.5 rounded-2xl border border-white/10 bg-slate-900/95 px-2 py-1.5 shadow-[0_12px_32px_rgba(2,6,23,0.5)] backdrop-blur">
          {ITEMS.map(({ href, label, icon }) => navLink(href, label, icon))}

          {/* Pesquisar — abre o overlay */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Pesquisar"
            aria-expanded={searchOpen}
            className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-slate-300 transition-colors active:bg-white/10"
          >
            <Search className="h-6 w-6" aria-hidden="true" />
            <span className="text-[10px] font-semibold">Pesquisar</span>
          </button>

          {/* IA — abre o assistente em qualquer ponto do site (Fase 16) */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(AI_CHAT_OPEN_EVENT))}
            aria-label="Abrir assistente de IA"
            className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-slate-300 transition-colors active:bg-white/10"
          >
            <span className="relative">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="text-[10px] font-semibold">IA</span>
          </button>

          {navLink('/carrinho', 'Carrinho', ShoppingBag, count)}
          {navLink('/perfil', 'Perfil', User)}
        </div>
      </nav>
    </>
  );
}
