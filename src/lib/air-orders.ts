/**
 * AngoStart — Lib partilhado do sistema «Pedidos no Ar» (Fase 16).
 *
 * Client-safe (sem 'server-only') — usado pelas rotas API e pela página
 * /pedidos. Categorias alinhadas com o diretório de prestadores
 * (api/prestadores) para um marketplace coerente.
 */

export const AIR_ORDER_STATUSES = [
  'aberto',
  'aceite',
  'concluido',
  'cancelado',
] as const;

export type AirOrderStatus = (typeof AIR_ORDER_STATUSES)[number];

export const AIR_ORDER_CATEGORIES = [
  { value: 'design', label: 'Design' },
  { value: 'programacao', label: 'Programação' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'electricidade', label: 'Electricidade' },
  { value: 'canalizacao', label: 'Canalização' },
  { value: 'beleza', label: 'Beleza' },
  { value: 'fotografia', label: 'Fotografia' },
  { value: 'educacao', label: 'Educação' },
  { value: 'traducao', label: 'Tradução' },
  { value: 'reparacoes', label: 'Reparações' },
  { value: 'mecanica', label: 'Mecânica' },
  { value: 'costura', label: 'Costura' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'outro', label: 'Outro' },
] as const;

export function airOrderCategoryLabel(value: string): string {
  return (
    AIR_ORDER_CATEGORIES.find((c) => c.value === value)?.label ?? 'Outro'
  );
}

export function isValidAirOrderCategory(value: string): boolean {
  return AIR_ORDER_CATEGORIES.some((c) => c.value === value);
}

export interface AirOrderRow {
  id: number;
  user_id: number;
  provider_id: number | null;
  category: string;
  title: string;
  description: string;
  budget_kz: string | number | null;
  cidade: string | null;
  status: AirOrderStatus;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  /** Nome público de quem publicou (JOIN users — nunca contactos). */
  publisher_name: string | null;
  /** Nome público do prestador que aceitou (JOIN users). */
  provider_name: string | null;
}

export const AIR_ORDER_TITLE_MAX = 140;
export const AIR_ORDER_DESC_MAX = 2000;
