/**
 * AngoStart — Tiles de Categoria da Home (Fase 18).
 *
 * 4 categorias em destaque, logo abaixo da Barra de Valor: cada tile tem
 * ícone grande (gradiente azul/roxo), nome, descrição curta e botão
 * «Ver Categoria» que leva ao catálogo já filtrado (?tipo=…).
 * Server component estático.
 */

import Link from 'next/link';
import { ArrowRight, Globe, GraduationCap, Home as HomeIcon, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { PRODUCT_TYPES, PRODUCT_TYPE_ORDER } from '@/lib/products-data';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  infoproduto: GraduationCap,
  produto_fisico: Package,
  servico_domicilio: HomeIcon,
  servico_remoto: Globe,
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  infoproduto:
    'eBooks, cursos online e templates prontos para acelerar o teu conhecimento e o teu negócio.',
  produto_fisico:
    'Telemóveis, acessórios e eletrodomésticos com garantia e entrega rápida em Luanda.',
  servico_domicilio:
    'Limpeza, electricista, canalização e ar condicionado — profissionais verificados à tua porta.',
  servico_remoto:
    'Design, websites e redes sociais feitos à distância, com qualidade internacional.',
};

export default function CategoryTiles() {
  return (
    <section aria-label="Categorias em destaque" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Explora por categoria
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
          Quatro caminhos rápidos para encontrares exatamente o que precisas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCT_TYPE_ORDER.map((type, i) => {
          const info = PRODUCT_TYPES[type];
          const Icon = CATEGORY_ICONS[type];
          return (
            <FadeIn key={type} delay={0.05 * i} className="h-full">
              <Link
                href={`/produtos?tipo=${type}`}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${info.gradient} text-white shadow-lg`}
                >
                  <Icon className="h-7 w-7" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {info.label}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">
                  {CATEGORY_DESCRIPTIONS[type]}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-600 transition-all group-hover:bg-blue-600 group-hover:text-white">
                  Ver Categoria
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </FadeIn>
          );
        })}
      </div>
    </section>
  );
}
