import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

/**
 * AngoStart — Sessão privilegiada dos painéis admin (cookie HttpOnly + 2FA).
 *
 * Fluxo:
 *  1. Admin entra por /api/auth/login (JWT Bearer normal).
 *  2. No painel oculto, introduz o código TOTP de 6 dígitos
 *     (POST /api/auth/2fa/verify) — otplib valida e este módulo emite
 *     um cookie HttpOnly assinado (HS256) válido por 8 horas.
 *  3. O middleware de /admin e /admin-limitado só deixa passar com este
 *     cookie válido e com a role correta.
 *
 * ⚠️ As rotas admin não aparecem em menus, footer, sitemap ou robots.
 */

export const ADMIN_COOKIE = 'angostart_admin';
export const ADMIN_SESSION_HOURS = 8;

export interface AdminSession {
  sub: string;
  role: 'admin' | 'admin_limitado';
}

function getSecretKey(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

/** Assina a sessão admin (cookie) — HS256, expira em 8 h. */
export async function signAdminSession(session: AdminSession): Promise<string> {
  const key = getSecretKey();
  if (!key) throw new Error('JWT_SECRET ausente — impossível assinar sessão admin.');
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_HOURS}h`)
    .sign(key);
}

/** Verifica o cookie admin. Retorna a sessão ou null. */
export async function verifyAdminSession(
  token: string | undefined | null
): Promise<AdminSession | null> {
  if (!token) return null;
  const key = getSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (
      !payload.sub ||
      (payload.role !== 'admin' && payload.role !== 'admin_limitado')
    ) {
      return null;
    }
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/** Opções do cookie (HttpOnly; Secure apenas em HTTPS/produção). */
export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_HOURS * 60 * 60,
  };
}
