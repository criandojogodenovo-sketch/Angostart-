/**
 * AngoStart — Definições de perfis (partilhadas entre servidor e cliente).
 *
 * ⚠️ Este ficheiro NÃO pode aceder a process.env nem importar módulos de
 * servidor — é importado por Client Components (AuthContext, páginas).
 */

export const ROLES = [
  'cliente',
  'criador',
  'prestador_domicilio',
  'prestador_remoto',
  'admin',
  'admin_limitado',
] as const;

export const SELLER_ROLES = [
  'criador',
  'prestador_domicilio',
  'prestador_remoto',
] as const;

export const ADMIN_ROLES = ['admin', 'admin_limitado'] as const;

export type Role = (typeof ROLES)[number];
export type SellerRole = (typeof SELLER_ROLES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  cliente: 'Cliente',
  criador: 'Criador de Infoprodutos',
  prestador_domicilio: 'Prestador ao Domicílio',
  prestador_remoto: 'Freelancer Remoto',
  admin: 'Administrador',
  admin_limitado: 'Administrador Limitado',
};

export function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

export function isSellerRole(role: string | null | undefined): boolean {
  return !!role && (SELLER_ROLES as readonly string[]).includes(role);
}

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}
