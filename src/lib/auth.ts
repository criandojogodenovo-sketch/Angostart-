import 'server-only';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';

/**
 * AngoStart — Autenticação multi-perfil (server-side)
 *
 * ⚠️ SERVER-ONLY: lê JWT_SECRET e DATABASE_URL — protegido pelo pacote
 * `server-only`, nunca pode ser importado por um Client Component.
 * Os tipos/constantes partilhados vivem em `@/lib/roles` (client-safe).
 *
 * - JWT (HS256, expira em 7 dias) assinado com JWT_SECRET
 * - 6 perfis: cliente | criador | prestador_domicilio | prestador_remoto |
 *             admin | admin_limitado
 * - getAuthUser(request) valida o header `Authorization: Bearer <token>`
 *   e carrega o utilizador atual da base de dados Neon (rejeitando
 *   contas bloqueadas).
 */

import {
  ROLES,
  SELLER_ROLES,
  ROLE_LABELS,
  isValidRole,
  isSellerRole,
  isAdminRole,
  type Role,
  type SellerRole,
} from '@/lib/roles';

export { ROLES, SELLER_ROLES, ROLE_LABELS, isValidRole, isSellerRole, isAdminRole };
export type { Role, SellerRole };

/** Secret TOTP pendente de verificação (guardado temporariamente no user). */
const PENDING_2FA_SECRET = '__pending__';

/** Utilizador exposto pelas APIs (nunca inclui password_hash nem segredo 2FA). */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  username: string | null;
  telefone: string | null;
  bio: string | null;
  area_atuacao: string | null;
  cidade: string | null;
  especialidade: string | null;
  portfolio_url: string | null;
  blocked: boolean;
  /** Fase 9: TRUE → o cliente deve trocar a senha antes de continuar. */
  must_change_password?: boolean;
  /** Fase 9: verificação de identidade (BI aprovado pelo admin). */
  kyc_status?: string | null;
  is_verified_bi?: boolean;
}

export type UserRow = AuthUser & {
  blocked?: boolean | null;
  password_hash?: string | null;
};

/* ──────────────────────────────── 2FA ─────────────────────────────── */

/** Devolve o segredo TOTP ativo do utilizador (null se não ativado). */
export async function getTwoFactorSecret(userId: number): Promise<string | null> {
  const rows = (await sql`
    SELECT two_factor_secret, two_factor_enabled::boolean
    FROM users WHERE id = ${userId} LIMIT 1
  `) as unknown as { two_factor_secret: string | null; two_factor_enabled: boolean }[];
  const row = rows[0];
  if (!row?.two_factor_secret || !row.two_factor_enabled) return null;
  return row.two_factor_secret;
}

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
      SELECT id, name, email, role, username, telefone, bio, area_atuacao, cidade,
             especialidade, portfolio_url, blocked::boolean,
             must_change_password::boolean, kyc_status, is_verified_bi::boolean
      FROM users WHERE id = ${Number(payload.sub)} AND blocked = FALSE LIMIT 1
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
    username: row.username ?? null,
    telefone: row.telefone ?? null,
    bio: row.bio ?? null,
    area_atuacao: row.area_atuacao ?? null,
    cidade: row.cidade ?? null,
    especialidade: row.especialidade ?? null,
    portfolio_url: row.portfolio_url ?? null,
    blocked: Boolean(row.blocked),
    must_change_password: Boolean(row.must_change_password),
    kyc_status: row.kyc_status ?? null,
    is_verified_bi: Boolean(row.is_verified_bi),
  };
}

/* ─────────────────────────── Username público ─────────────────────── */

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

export { USERNAME_RE };

/** Gera um username único a partir do nome (slug portuguesa). */
export async function generateUniqueUsername(name: string): Promise<string> {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$|\.{2,}/g, '')
      .slice(0, 24)
      .replace(/^\.+|\.+$/g, '') || 'utilizador';

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const rows = (await sql`
      SELECT 1 FROM users WHERE username = ${candidate} LIMIT 1
    `) as unknown as unknown[];
    if (!rows[0]) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
