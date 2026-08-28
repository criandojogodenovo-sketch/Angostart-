import jwt, { type SignOptions } from 'jsonwebtoken';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';

/**
 * AngoStart — Autenticação multi-perfil (server-side)
 *
 * - JWT (HS256, expira em 7 dias) assinado com JWT_SECRET
 * - 4 perfis: cliente | criador | prestador_domicilio | prestador_remoto
 * - getAuthUser(request) valida o header `Authorization: Bearer <token>`
 *   e carrega o utilizador atual da base de dados Neon.
 */

export const ROLES = [
  'cliente',
  'criador',
  'prestador_domicilio',
  'prestador_remoto',
] as const;
export const SELLER_ROLES = [
  'criador',
  'prestador_domicilio',
  'prestador_remoto',
] as const;

export type Role = (typeof ROLES)[number];
export type SellerRole = (typeof SELLER_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  cliente: 'Cliente',
  criador: 'Criador de Infoprodutos',
  prestador_domicilio: 'Prestador ao Domicílio',
  prestador_remoto: 'Freelancer Remoto',
};

export function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

export function isSellerRole(role: string): boolean {
  return (SELLER_ROLES as readonly string[]).includes(role);
}

/** Utilizador exposto pelas APIs (nunca inclui password_hash). */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  telefone: string | null;
  bio: string | null;
  area_atuacao: string | null;
  cidade: string | null;
  especialidade: string | null;
  portfolio_url: string | null;
}

export type UserRow = AuthUser & { password_hash?: string | null };

// NOTA: o driver Neon não permite interpolar nomes de colunas como parâmetros —
// o SELECT tem de ter as colunas escritas literalmente no template.

/* ────────────────────────────── JWT ────────────────────────────── */

export function signToken(user: Pick<AuthUser, 'id' | 'email' | 'role'>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET não está definida. Adiciona-a ao .env.local (dev) e às Settings da Vercel (produção).'
    );
  }
  const options: SignOptions = { expiresIn: '7d' };
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    secret,
    options
  );
}

export function verifyToken(
  token: string
): { sub: string; email: string; role: Role } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as {
      sub?: string;
      email?: string;
      role?: Role;
    };
    if (!payload.sub || !payload.email || !payload.role) return null;
    return { sub: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

/* ───────────────────── Utilizador autenticado ──────────────────── */

export function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Devolve o utilizador autenticado (ou null).
 * Valida o JWT e recarrega os dados atuais do utilizador na BD —
 * assim alterações de perfil/role ficam imediatamente visíveis.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  try {
    const rows = (await sql`
      SELECT id, name, email, role, telefone, bio, area_atuacao, cidade,
             especialidade, portfolio_url
      FROM users WHERE id = ${Number(payload.sub)} LIMIT 1
    `) as unknown as AuthUser[];
    return rows[0] ?? null;
  } catch (error) {
    console.error('[auth] Erro ao carregar utilizador:', error);
    return null;
  }
}

/** Remove campos sensíveis e normaliza o utilizador para resposta HTTP. */
export function publicUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    telefone: row.telefone ?? null,
    bio: row.bio ?? null,
    area_atuacao: row.area_atuacao ?? null,
    cidade: row.cidade ?? null,
    especialidade: row.especialidade ?? null,
    portfolio_url: row.portfolio_url ?? null,
  };
}
