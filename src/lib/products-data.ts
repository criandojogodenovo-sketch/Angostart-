/**
 * AngoStart — Tipos, categorias e dados de fallback dos produtos.
 *
 * Os dados de fallback são usados quando a base de dados Neon está
 * temporariamente inacessível — assim o site nunca fica "vazio".
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

/** Catálogo de fallback (igual ao seed do Neon) — usado se a BD falhar. */
export const FALLBACK_PRODUCTS: Product[] = [
  { id: 1, name: 'eBook: Marketing Digital em Angola', description: 'Guia prático com estratégias de vendas online adaptadas ao mercado angolano: WhatsApp Business, Facebook e Instagram. 120 páginas com casos reais de Luanda.', price_kz: 12500, type: 'infoproduto', icon: 'book-open', gradient: 'from-emerald-500 to-teal-600', featured: true, rating: 4.8, stock: -1 },
  { id: 2, name: 'Curso Online: Excel para Negócios', description: 'Aprende Excel do básico ao avançado com foco em gestão de pequenas empresas: facturas, stock e relatórios. 8 módulos em vídeo + certificado.', price_kz: 25000, type: 'infoproduto', icon: 'graduation-cap', gradient: 'from-blue-600 to-cyan-500', featured: true, rating: 4.9, stock: -1 },
  { id: 3, name: 'Pack de Templates: Plano de Negócios', description: 'Modelos editáveis de plano de negócios, facturação e controlo de stock prontos para empresas angolanas. Compatível com Word e Excel.', price_kz: 15000, type: 'infoproduto', icon: 'layout-template', gradient: 'from-violet-600 to-purple-500', featured: false, rating: 4.6, stock: -1 },
  { id: 4, name: 'Curso: Programação do Zero', description: 'Curso completo de introdução à programação web (HTML, CSS e JavaScript). Ideal para quem quer começar na área de tecnologia em Angola.', price_kz: 45000, type: 'infoproduto', icon: 'code-2', gradient: 'from-orange-500 to-amber-500', featured: false, rating: 4.7, stock: -1 },
  { id: 5, name: 'Smartphone Samsung Galaxy A15 128GB', description: 'Telemóvel novo com ecrã de 6.5", câmara tripla de 50MP, bateria de 5000mAh e garantia de 12 meses. Lacrado, com factura.', price_kz: 145000, type: 'produto_fisico', icon: 'smartphone', gradient: 'from-slate-700 to-slate-900', featured: true, rating: 4.7, stock: 8 },
  { id: 6, name: 'Headset Bluetooth JBL Tune 520BT', description: 'Auscultadores sem fios com som Pure Bass, bateria para até 57 horas e microfone integrado. Perfeito para música e chamadas.', price_kz: 25000, type: 'produto_fisico', icon: 'headphones', gradient: 'from-rose-500 to-pink-600', featured: false, rating: 4.5, stock: 15 },
  { id: 7, name: 'Power Bank 20000mAh Carga Rápida', description: 'Carregador portátil com duas saídas USB e entrada USB-C, carga rápida de 22.5W. Ideal para falhas de energia e uso no dia-a-dia.', price_kz: 18500, type: 'produto_fisico', icon: 'battery-charging', gradient: 'from-lime-500 to-green-600', featured: false, rating: 4.4, stock: 22 },
  { id: 8, name: 'Ventilador de Mesa Oscilante 40cm', description: 'Ventilador silencioso de 3 velocidades com oscilação, ideal para o calor de Luanda. Poupa energia e tem garantia de 6 meses.', price_kz: 22000, type: 'produto_fisico', icon: 'wind', gradient: 'from-cyan-500 to-sky-600', featured: false, rating: 4.3, stock: 10 },
  { id: 9, name: 'Limpeza Doméstica Completa (Diária)', description: 'Serviço de limpeza profissional para casas e apartamentos em Luanda: varrer, lavar, passar e organizar. Profissionais verificadas.', price_kz: 10000, type: 'servico_domicilio', icon: 'sparkles', gradient: 'from-emerald-500 to-green-600', featured: true, rating: 4.9, stock: -1 },
  { id: 10, name: 'Reparação Elétrica Residencial', description: 'Electricista certificado para instalações, reparações e substituição de disjuntores em casa. Atendimento em 24h com garantia de serviço.', price_kz: 15000, type: 'servico_domicilio', icon: 'zap', gradient: 'from-yellow-500 to-orange-500', featured: false, rating: 4.6, stock: -1 },
  { id: 11, name: 'Instalação de Ar Condicionado', description: 'Instalação profissional de AC split com material incluído e teste de funcionamento. Disponível para talões e empresas em Luanda.', price_kz: 30000, type: 'servico_domicilio', icon: 'air-vent', gradient: 'from-sky-500 to-blue-600', featured: false, rating: 4.7, stock: -1 },
  { id: 12, name: 'Reparação de Canalização (Fugas)', description: 'Técnico de canalização para fugas de água, torneiras e autocismos. Diagnóstico rápido e preço fechado antes do serviço.', price_kz: 12000, type: 'servico_domicilio', icon: 'wrench', gradient: 'from-indigo-500 to-blue-700', featured: false, rating: 4.5, stock: -1 },
  { id: 13, name: 'Design de Logotipo Profissional', description: 'Logotipo único para o teu negócio com 3 propostas, revisões ilimitadas e ficheiros finais em todos os formatos (PNG, PDF, AI).', price_kz: 35000, type: 'servico_remoto', icon: 'palette', gradient: 'from-fuchsia-500 to-purple-600', featured: true, rating: 4.8, stock: -1 },
  { id: 14, name: 'Criação de Website Empresarial', description: 'Website profissional até 5 páginas, responsivo, otimizado para o Google e ligado ao teu WhatsApp. Entrega em 7 dias.', price_kz: 120000, type: 'servico_remoto', icon: 'globe', gradient: 'from-teal-500 to-cyan-600', featured: false, rating: 4.9, stock: -1 },
  { id: 15, name: 'Gestão de Redes Sociais (Mensal)', description: 'Gestão completa do Instagram e Facebook: 12 publicações por mês, stories, resposta a clientes e relatório de resultados.', price_kz: 60000, type: 'servico_remoto', icon: 'share-2', gradient: 'from-pink-500 to-rose-600', featured: false, rating: 4.6, stock: -1 },
];

export function isProductType(value: string | null): value is ProductType {
  return !!value && (PRODUCT_TYPE_ORDER as string[]).includes(value);
}
