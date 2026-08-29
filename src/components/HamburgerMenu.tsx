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
  MessageCircle,
  Phone,
  Plus,
  ShoppingBag,
  ShoppingCart,
  User,
  Wallet,
  Wrench,
  X,
  Home,
} from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import { useAuth } from '@/context/AuthContext';

const LINKS = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/produtos', label: 'Produtos', icon: ShoppingBag },
  { href: '/prestadores', label: 'Prestadores', icon: Wrench },
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/perfil', label: 'Perfil', icon: User },
  { href: '/carteira', label: 'Carteira', icon: Wallet },
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
        className={`fixed right-0 top-0 z-[70] flex h-full w-[86%] max-w-xs flex-col bg-slate-900 text-white shadow-[0_0_50px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition-transform duration-300 ease-out md:hidden ${
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
          <ul className="space-y-2">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onClose}
                    className={`flex items-center gap-4 rounded-xl px-5 py-4 text-base font-semibold transition-colors ${
                      active
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-slate-100 hover:bg-white/15 hover:text-white'
                    }`}
                  >
                    <Icon className="h-6 w-6" />
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
                  className={`flex items-center gap-4 rounded-xl px-5 py-4 text-base font-semibold transition-colors ${
                    pathname.startsWith('/dashboard')
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-100 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  <BarChart3 className="h-6 w-6" />
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
                  className={`flex items-center gap-4 rounded-xl px-5 py-4 text-base font-semibold transition-colors ${
                    pathname === '/adicionar-produto'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  <Plus className="h-6 w-6" />
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
