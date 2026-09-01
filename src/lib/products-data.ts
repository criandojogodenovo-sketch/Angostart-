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
  /**
   * Fase 11: média REAL de avaliações (1–5) ou NULL quando o produto
   * ainda não tem avaliações — a UI mostra "Sem avaliações". Nunca mais
   * um 4.5 por omissão a fazer de conta.
   */
  rating: number | null;
  /**
   * 🔒 Fase 6 (ponto 3): a cota interna (`stock`) só é visível ao DONO
   * (vistas "meu=1" e detalhe para dono/admin). Nas vistas públicas a API
   * devolve apenas `available` (disponibilidade derivada).
   */
  stock?: number | null;
  /** Disponibilidade pública (derivada do stock; -1 = ilimitado). */
  available?: boolean;
  /* Campos do marketplace (presentes nos produtos vindos do Neon) */
  user_id?: number | null;
  image_url?: string | null;
  seller_name?: string | null;
  seller_role?: string | null;
  /** Selo azul de verificação (Fase 9) — BI aprovado pelo admin. */
  seller_verified?: boolean;
  /** PDF do infoproduto (Vercel Blob) — download só após compra paga. */
  file_url?: string | null;
  service_lat?: number | null;
  service_lng?: number | null;
  /* Fase 11 — botão "Ver loja" / "Ver vendedor" nos cartões */
  seller_username?: string | null;
  store_slug?: string | null;
  /**
   * Fase 15 — palavras-chave de busca (até 10, lowercase, sem acentos
   * normalizados em minúsculas). NULL/vazio quando o vendedor não definiu
   * ou a migração Fase 15 ainda não correu.
   */
  keywords?: string[] | null;
}

export const PRODUCT_TYPES: Record<
  ProductType,
  { label: string; short: string; icon: string; gradient: string }
> = {
  infoproduto: {
    label: 'Infoprodutos',
    short: 'Infoprodutos',
    icon: 'graduation-cap',
    gradient: 'from-blue-600 to-teal-600',
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
    gradient: 'from-teal-500 to-blue-600',
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

/**
 * Fase 19 — gradientes aprovados (identidade azul/roxo/teal).
 * O `gradient` de cada produto vive na BD e pode ter sido guardado antes do
 * redesign (ex.: tons esmeralda/verdes). Qualquer valor fora desta whitelist
 * cai no gradiente do tipo — coesão visual garantida sem migrar dados.
 */
const APPROVED_GRADIENTS = new Set<string>([
  'from-blue-600 to-teal-600', // infoproduto
  'from-blue-600 to-cyan-500', // produto físico
  'from-teal-500 to-blue-600', // serviço ao domicílio
  'from-violet-600 to-purple-500', // serviço remoto
  'from-blue-600 to-purple-600', // gradiente principal da marca
]);

/**
 * Devolve o gradiente seguro para o cabeçalho/ilustração de um produto.
 * Nunca devolve verde: valores antigos (esmeralda etc.) são substituídos
 * pelo gradiente do tipo (azul→teal, azul→roxo, …). Aceita `type` como
 * `string` para servir também payloads de API sem tipagem estrita.
 */
export function getProductGradient(
  product: { gradient?: string | null; type: string },
): string {
  const g = (product.gradient ?? '').trim();
  if (APPROVED_GRADIENTS.has(g)) return g;
  return (
    PRODUCT_TYPES[product.type as ProductType]?.gradient ??
    'from-blue-600 to-purple-600'
  );
}

export function isProductType(value: string | null): value is ProductType {
  return !!value && (PRODUCT_TYPE_ORDER as string[]).includes(value);
}
