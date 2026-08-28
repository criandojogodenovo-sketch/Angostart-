'use client';

/**
 * AngoStart — Menu móvel (hambúrguer) com navegação, pesquisa e contactos.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Facebook,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShoppingBag,
  ShoppingCart,
  User,
  X,
  Home,
} from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import { useAuth } from '@/context/AuthContext';

const LINKS = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/produtos', label: 'Produtos', icon: ShoppingBag },
  { href: '/perfil', label: 'Perfil', icon: User },
  { href: '/carrinho', label: 'Carrinho', icon: ShoppingCart },
];

export default function HamburgerMenu({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { isSeller, user } = useAuth();

  return (
    <>
      {/* Fundo escurecido */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Painel lateral */}
      <aside
        id="menu-mobile"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[70] flex h-full w-[82%] max-w-xs flex-col bg-slate-900 text-white shadow-2xl transition-transform duration-300 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <p className="text-lg font-bold">
            Ango<span className="text-emerald-400">Start</span>
          </p>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <SearchBar onSearched={onClose} />
        </div>

        <nav className="flex-1 px-3" aria-label="Navegação móvel">
          <ul className="space-y-1">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-slate-200 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </Link>
                </li>
              );
            })}
            {/* Painel de vendas — apenas vendedores autenticados */}
            {user && isSeller && (
              <li>
                <Link
                  href="/dashboard/vendedor"
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    pathname.startsWith('/dashboard')
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <BarChart3 className="h-5 w-5" />
                  Painel de vendas
                </Link>
              </li>
            )}
            {/* Publicar — visível apenas para vendedores autenticados */}
            {user && isSeller && (
              <li>
                <Link
                  href="/adicionar-produto"
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    pathname === '/adicionar-produto'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  <Plus className="h-5 w-5" />
                  Adicionar Produto
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-white/10 px-5 py-4 text-sm text-slate-300">
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-400" /> Luanda, Angola
          </p>
          <p className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-emerald-400" /> +244 958 176 915
          </p>
          <p className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-emerald-400" /> geral@angostart.ao
          </p>
          <div className="flex gap-3 pt-2">
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook da AngoStart"
              className="rounded-full bg-white/10 p-2 hover:bg-emerald-500 hover:text-white"
            >
              <Facebook className="h-4 w-4" />
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram da AngoStart"
              className="rounded-full bg-white/10 p-2 hover:bg-emerald-500 hover:text-white"
            >
              <Instagram className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
