/**
 * AngoStart — Tipos e categorias de produtos.
 *
 * Fase 4: catálogo REAL — os produtos vivem exclusivamente no Neon;
 * já não existem dados de exemplo em memória.
 */

export type ProductType =
  | 'infoproduto'
  | 'produto_fisico'
  | 'servico_domicilio'
  | 'servico_remoto';

export interface Product {
  id: number;
  name: string;
  description: string;
  price_kz: number;
  type: ProductType;
  icon: string;
  gradient: string;
  featured: boolean;
  /** Produto "em alta" — badge de chama 🔥 escolhido pelo vendedor. */
  is_hot?: boolean;
  rating: number;
  stock: number; // -1 = ilimitado (infoprodutos e serviços)
  /* Campos do marketplace (presentes nos produtos vindos do Neon) */
  user_id?: number | null;
  image_url?: string | null;
  seller_name?: string | null;
  seller_role?: string | null;
}

export const PRODUCT_TYPES: Record<
  ProductType,
  { label: string; short: string; icon: string; gradient: string }
> = {
  infoproduto: {
    label: 'Infoprodutos',
    short: 'Infoprodutos',
    icon: 'graduation-cap',
    gradient: 'from-emerald-500 to-teal-600',
  },
  produto_fisico: {
    label: 'Produtos Físicos',
    short: 'Produtos',
    icon: 'package',
    gradient: 'from-blue-600 to-cyan-500',
  },
  servico_domicilio: {
    label: 'Serviço ao Domicílio',
    short: 'Domicílio',
    icon: 'home',
    gradient: 'from-orange-500 to-amber-500',
  },
  servico_remoto: {
    label: 'Serviço Remoto',
    short: 'Remoto',
    icon: 'globe',
    gradient: 'from-violet-600 to-purple-500',
  },
};

export const PRODUCT_TYPE_ORDER: ProductType[] = [
  'infoproduto',
  'produto_fisico',
  'servico_domicilio',
  'servico_remoto',
];

export function isProductType(value: string | null): value is ProductType {
  return !!value && (PRODUCT_TYPE_ORDER as string[]).includes(value);
}
