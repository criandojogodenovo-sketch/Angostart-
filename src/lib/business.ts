/**
 * AngoStart — Lib partilhado dos Estabelecimentos (Fase 16).
 * Client-safe — usado pelas rotas API e pelas páginas públicas.
 */

export const BUSINESS_CATEGORIES = [
  { value: 'loja', label: 'Loja' },
  { value: 'hotel', label: 'Hotel / Hospedagem' },
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'salao', label: 'Salão de Beleza' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'farmacia', label: 'Farmácia' },
  { value: 'mercado', label: 'Supermercado / Mercado' },
  { value: 'academia', label: 'Academia' },
  { value: 'outro', label: 'Outro' },
] as const;

export function businessCategoryLabel(value: string): string {
  return BUSINESS_CATEGORIES.find((c) => c.value === value)?.label ?? 'Estabelecimento';
}

export function isValidBusinessCategory(value: string): boolean {
  return BUSINESS_CATEGORIES.some((c) => c.value === value);
}

export interface BusinessProfile {
  id: number;
  user_id: number;
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  horario: string | null;
  logo_url: string | null;
  fotos: string[];
  active: boolean;
  created_at: string;
  /** JOIN users — nome público do responsável (sem contactos). */
  owner_name?: string | null;
  owner_username?: string | null;
  cidade?: string | null;
}
