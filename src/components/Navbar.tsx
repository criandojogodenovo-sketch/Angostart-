'use client';

/**
 * AngoStart — Navbar fixa com menu hambúrguer no mobile,
 * links no desktop, barra de pesquisa e carrinho.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Plus, Rocket, ShoppingCart } from 'lucide-react';
import HamburgerMenu from '@/components/HamburgerMenu';
import SearchBar from '@/components/SearchBar';
import NotificationBell from '@/components/NotificationBell';
import { useCart } from '@/context/StoreContext';
import { useAuth } from '@/context/AuthContext';

const LINKS = [
  { href: '/', label: 'Início' },
  { href: '/produtos', label: 'Produtos' },
  { href: '/lojas', label: 'Lojas' },
  { href: '/prestadores', label: 'Portfólios' },
  { href: '/chat', label: 'Chat' },
  { href: '/perfil', label: 'Perfil' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { count } = useCart();
  const { isSeller, user } = useAuth();

  return (
    <>
      <header className="glass-navbar sticky top-0 z-50 w-full text-slate-900">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="AngoStart — Página inicial">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-md">
            <Rocket className="h-5 w-5 text-white" />
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Ango<span className="text-blue-600">Start</span>
          </span>
        </Link>

        {/* Links desktop */}
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Navegação principal">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-600 hover:bg-gray-100 hover:text-slate-900'
                }`}
              >
                {label}
              </Link>
            );
          })}
          {/* Publicar + Painel — visíveis apenas para vendedores autenticados */}
          {user && isSeller && (
            <Link
              href="/dashboard/vendedor"
              className={`hidden md:inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                pathname.startsWith('/dashboard')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-blue-600 hover:bg-blue-50'
              }`}
            >
              Painel
            </Link>
          )}
          {user && isSeller && (
            <Link
              href="/adicionar-produto"
              className={`ml-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors ${
                pathname === '/adicionar-produto'
                  ? 'bg-blue-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Plus className="h-4 w-4" />
              Adicionar Produto
            </Link>
          )}
        </nav>

        <div className="flex-1" />

        {/* Pesquisa desktop */}
        <div className="hidden w-72 lg:block">
          <SearchBar />
        </div>

        {/* Sino de notificações (Fase 5) */}
        <NotificationBell />

        {/* Carrinho */}
        <Link
          href="/carrinho"
          aria-label={`Carrinho de compras (${count} artigos)`}
          className={`relative ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
            pathname === '/carrinho'
              ? 'bg-blue-50 text-blue-600'
              : 'text-slate-600 hover:bg-gray-100 hover:text-slate-900'
          }`}
        >
          <ShoppingCart className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-bold text-white shadow">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>

        {/* Hambúrguer mobile */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={menuOpen}
          aria-controls="menu-mobile"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-gray-100 hover:text-slate-900 md:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      </header>

      {/* Fora do <header>: backdrop-blur do header cria um containing block
          que partiria o posicionamento fixed do menu (painel com 64px). */}
      <HamburgerMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
