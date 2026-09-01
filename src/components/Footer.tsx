'use client';

/**
 * AngoStart — Rodapé com contactos em Luanda, redes sociais e links rápidos.
 */

import Link from 'next/link';
import {
  Clock,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Rocket,
} from 'lucide-react';

const QUICK_LINKS = [
  { href: '/', label: 'Início' },
  { href: '/produtos', label: 'Produtos' },
  { href: '/prestadores', label: 'Prestadores de serviços' },
  { href: '/chat', label: 'Chat' },
  { href: '/carteira', label: 'Carteira' },
  { href: '/perfil', label: 'Perfil' },
  { href: '/carrinho', label: 'Carrinho' },
];

export default function Footer() {
  return (
    <footer className="mt-auto w-full bg-slate-900 text-slate-300">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Marca */}
          <div>
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-teal-500">
                <Rocket className="h-5 w-5 text-white" />
              </span>
              <span className="text-xl font-bold text-white">
                Ango<span className="text-blue-400">Start</span>
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed">
              A tua plataforma angolana de infoprodutos, produtos físicos e
              serviços ao domicílio e remotos. Qualidade garantida e
              pagamento acessível, feita para impulsionar negócios em Angola.
            </p>
            <div className="mt-5 flex gap-3">
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook da AngoStart"
                className="rounded-full bg-white/10 p-2.5 transition-colors hover:bg-blue-600 hover:text-white"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram da AngoStart"
                className="rounded-full bg-white/10 p-2.5 transition-colors hover:bg-blue-600 hover:text-white"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn da AngoStart"
                className="rounded-full bg-white/10 p-2.5 transition-colors hover:bg-blue-600 hover:text-white"
              >
                <Linkedin className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Contactos */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Contactos
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>
                  Rua Rainha Ginga, n.º 25
                  <br />
                  Ingombota, Luanda — Angola
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 shrink-0 text-blue-400" />
                <a href="tel:+244958176915" className="hover:text-white">
                  +244 958 176 915
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-blue-400" />
                <a href="mailto:geral@angostart.ao" className="hover:text-white">
                  geral@angostart.ao
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-blue-400" />
                <span>Seg–Sáb: 08h00 às 18h00</span>
              </li>
            </ul>
          </div>

          {/* Links rápidos */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Links Rápidos
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              {QUICK_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex items-center gap-2 transition-colors hover:text-blue-400"
                  >
                    <span className="h-1 w-1 rounded-full bg-blue-400" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-xs leading-relaxed text-blue-300">
                Pagamento por KWiK (transferência instantânea), carteira
                AngoStart com escrow, transferência bancária (BAI, BFA) e
                dinheiro na entrega.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-400 sm:flex-row">
          <p>© {new Date().getFullYear()} AngoStart. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <Link href="/termos" className="transition-colors hover:text-blue-400">
              Termos de Uso
            </Link>
            <Link href="/privacidade" className="transition-colors hover:text-blue-400">
              Política de Privacidade
            </Link>
            <p>Feito em Luanda, para Angola.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
