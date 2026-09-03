'use client';

/**
 * AngoStart — Menu móvel (hambúrguer) com navegação, pesquisa e contactos.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Building2,
  Facebook,
  Instagram,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Clapperboard,
  Store,
  User,
  Wallet,
  Wrench,
  X,
  Home,
} from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

const LINKS = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/produtos', label: 'Produtos', icon: ShoppingBag },
  { href: '/pedidos', label: 'Pedidos', icon: Megaphone },
  { href: '/estabelecimentos', label: 'Espaços', icon: Building2 },
  { href: '/lojas', label: 'Lojas', icon: Store },
  { href: '/prestadores', label: 'Portfólios', icon: Wrench },
  { href: '/busbt', label: 'Busbt', icon: Clapperboard },
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
      {/* Fundo escurecido + blur (Fase 20) — o menu entra com profundidade */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Painel lateral — slide-in da direita (ease-out premium) */}
      <aside
        id="menu-mobile"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[70] flex h-dvh w-[86%] max-w-xs flex-col glass-panel text-white shadow-[0_0_50px_rgba(0,0,0,0.55)] transition-transform duration-[350ms] ease-[cubic-bezier(0.21,0.47,0.32,0.98)] md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <p className="text-lg font-bold">
            Ango<span className="text-blue-300">Start</span>
          </p>
          <div className="flex items-center gap-1">
            <ThemeToggle className="text-slate-300 hover:bg-white/10 hover:text-white" />
            <button
              onClick={onClose}
              aria-label="Fechar menu"
              className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Cartão do utilizador (Fase 17) — reflete a foto de perfil na
            hora via AuthContext (sem refresh), igual à Navbar. */}
        {user && (
          <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
            {user.profile_image ? (
              <img
                src={user.profile_image}
                alt={`Foto de ${user.name}`}
                className="h-11 w-11 rounded-full border-2 border-blue-400/60 object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-bold text-white">
                {(user.name || 'U')
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <Link
                href="/perfil"
                onClick={onClose}
                className="text-xs font-medium text-blue-300 hover:underline"
              >
                Ver o meu perfil
              </Link>
            </div>
          </div>
        )}

        <div className="px-6 py-4">
          <SearchBar onSearched={onClose} />
        </div>

        <nav className="flex-1 overflow-y-auto px-4" aria-label="Navegação móvel">
          {/* Links em cascata (stagger) — cada item entra da direita com
              atraso incremental quando o menu abre (Fase 20) */}
          <motion.ul
            className="space-y-2"
            initial="closed"
            animate={open ? 'open' : 'closed'}
            variants={{
              open: { transition: { staggerChildren: 0.045, delayChildren: 0.1 } },
              closed: { transition: { staggerDirection: -1 } },
            }}
          >
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <motion.li
                  key={href}
                  variants={{
                    closed: { opacity: 0, x: 32 },
                    open: {
                      opacity: 1,
                      x: 0,
                      transition: { duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] },
                    },
                  }}
                >
                  <Link
                    href={href}
                    onClick={onClose}
                    className={`group flex items-center gap-4 rounded-xl px-5 py-3.5 text-base font-semibold transition-all ${
                      active
                        ? 'bg-blue-600/20 text-white'
                        : 'text-white hover:bg-white/10 hover:translate-x-1'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${
                        active
                          ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-md'
                          : 'bg-white/5 text-blue-300'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    {label}
                  </Link>
                </motion.li>
              );
            })}
            {/* Painel de vendas — apenas vendedores autenticados */}
            {user && isSeller && (
              <motion.li
                variants={{
                  closed: { opacity: 0, x: 32 },
                  open: {
                    opacity: 1,
                    x: 0,
                    transition: { duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] },
                  },
                }}
              >
                <Link
                  href="/dashboard/vendedor"
                  onClick={onClose}
                  className={`group flex items-center gap-4 rounded-xl px-5 py-3.5 text-base font-semibold transition-all ${
                    pathname.startsWith('/dashboard')
                      ? 'bg-blue-600/20 text-white'
                      : 'text-white hover:bg-white/10 hover:translate-x-1'
                  }`}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-blue-300 transition-transform group-hover:scale-110">
                    <BarChart3 className="h-5 w-5" />
                  </span>
                  Painel de vendas
                </Link>
              </motion.li>
            )}
            {/* Publicar — visível apenas para vendedores autenticados */}
            {user && isSeller && (
              <motion.li
                variants={{
                  closed: { opacity: 0, x: 32 },
                  open: {
                    opacity: 1,
                    x: 0,
                    transition: { duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] },
                  },
                }}
              >
                <Link
                  href="/adicionar-produto"
                  onClick={onClose}
                  className={`btn-shine flex items-center gap-4 rounded-xl px-5 py-3.5 text-base font-semibold transition-all ${
                    pathname === '/adicionar-produto'
                      ? 'bg-white/10 text-blue-300'
                      : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/25 hover:brightness-110'
                  }`}
                >
                  <Plus className="h-6 w-6" />
                  Adicionar Produto
                </Link>
              </motion.li>
            )}
          </motion.ul>
        </nav>

        <div className="space-y-2 border-t border-white/10 px-6 py-5 text-sm text-slate-200">
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-300" /> Luanda, Angola
          </p>
          <p className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-blue-300" /> +244 958 176 915
          </p>
          <p className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-300" /> geral@angostart.ao
          </p>
          <div className="flex gap-3 pt-2">
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook da AngoStart"
              className="rounded-full bg-white/10 p-2 hover:bg-blue-600 hover:text-white"
            >
              <Facebook className="h-4 w-4" />
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram da AngoStart"
              className="rounded-full bg-white/10 p-2 hover:bg-blue-600 hover:text-white"
            >
              <Instagram className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
