import 'server-only';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getAuthUser, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { verifyAdminSession, ADMIN_COOKIE } from '@/lib/admin-session';
import { isAdminRole, type Role } from '@/lib/roles';

/**
 * AngoStart — Utilitários de segurança (server-side).
 *
 * - Sanitização de inputs (defesa em profundidade contra XSS armazenado —
 *   o React já escapa na renderização, mas nunca guardamos HTML ativo).
 * - Rate limiting em memória por chave (IP+rota).
 * - Guards de autorização para rotas API (role-based).
 * - Normalização de telefones angolanos (Multicaixa/WhatsApp).
 * - Verificação HMAC de webhooks (timing-safe).
 */

/* ──────────────────────────── Sanitização ──────────────────────────── */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_BLOCKS = /<\s*(script|iframe|object|embed|link|style|svg[^>]*on\w+)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi;
const HTML_TAGS = /<[^>]*>/g;
const EVENT_ATTRS = /\bon\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi;
const JS_URLS = /(javascript|data|vbscript)\s*:/gi;

/**
 * Remove HTML ativo, handlers de eventos, URLs javascript: e caracteres de
 * controlo. Usar em TODOS os textos guardados na base de dados.
 */
export function sanitizeText(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(SCRIPT_BLOCKS, '')
    .replace(HTML_TAGS, '')
    .replace(EVENT_ATTRS, '')
    .replace(JS_URLS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Versão para descrições — preserva quebras de linha simples. */
export function sanitizeMultiline(input: unknown, maxLength = 3000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(SCRIPT_BLOCKS, '')
    .replace(HTML_TAGS, '')
    .replace(EVENT_ATTRS, '')
    .replace(JS_URLS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Aceita apenas http(s) sem credenciais embutidas — evita javascript:/data:. */
export function isSafeHttpUrl(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  if (value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

/* ──────────────────────────── Rate limiting ────────────────────────── */

interface RateEntry {
  count: number;
  resetAt: number;
}

const globalForRate = globalThis as unknown as {
  angostartRateMap: Map<string, RateEntry> | undefined;
};
const rateMap = globalForRate.angostartRateMap ?? new Map<string, RateEntry>();
globalForRate.angostartRateMap = rateMap;

/**
 * Limitador de taxa em memória. Retorna false quando excedido.
 * Nota: em serverless cada instância tem a sua memória — é uma defesa
 * básica; para produção pesada usar um store partilhado (ex.: Upstash).
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || entry.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    if (rateMap.size > 10_000) cleanupRateMap(now);
    return true;
  }
  entry.count += 1;
  if (entry.count > max) return false;
  return true;
}

function cleanupRateMap(now: number) {
  for (const [key, entry] of rateMap) {
    if (entry.resetAt <= now) rateMap.delete(key);
  }
}

/** Chave de rate limit baseada no IP do pedido. */
export function clientKey(request: NextRequest, scope: string): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  return `${scope}:${ip}`;
}

/* ─────────────────────── Autorização (role guards) ─────────────────── */

export type AuthzFailure = { ok: false; status: 401 | 403; error: string };
export type AuthzSuccess<U extends AuthUser = AuthUser> = { ok: true; user: U };

/**
 * Resolve o utilizador autenticado por Bearer JWT OU, em alternativa,
 * pelo cookie de sessão admin (assinado com 2FA) — os painéis precisam
 * de ambos os canais.
 */
async function resolveAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const bearerUser = await getAuthUser(request);
  if (bearerUser) return bearerUser;

  const session = await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!session) return null;

  // DB é a fonte de verdade (role/blocked atuais)
  const rows = (await sql`
    SELECT id, name, email, role, username, telefone, bio, area_atuacao, cidade,
           especialidade, portfolio_url, blocked::boolean
    FROM users
    WHERE id = ${Number(session.sub)} AND blocked = FALSE
    LIMIT 1
  `) as unknown as AuthUser[];
  return rows[0] ?? null;
}

/**
 * Exige sessão válida e, opcionalmente, um dos roles indicados.
 * Utilizadores bloqueados já são rejeitados em getAuthUser.
 */
export async function requireRole(
  request: NextRequest,
  roles?: readonly Role[]
): Promise<AuthzFailure | AuthzSuccess> {
  const user = await resolveAuthUser(request);
  if (!user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada. Entra novamente.' };
  }
  if (roles && !roles.includes(user.role)) {
    return { ok: false, status: 403, error: 'Não tens permissão para esta ação.' };
  }
  return { ok: true, user };
}

/** Guard para APIs de administração total. */
export async function requireAdmin(request: NextRequest) {
  return requireRole(request, ['admin']);
}

/** Guard para APIs de administração (total + limitada). */
export async function requireAnyAdmin(request: NextRequest) {
  return requireRole(request, ['admin', 'admin_limitado']);
}

/** Guard para APIs de vendedores. */
export async function requireSeller(request: NextRequest) {
  return requireRole(request, ['criador', 'prestador_domicilio', 'prestador_remoto']);
}

export { isAdminRole };

/* ─────────────────────── Telefones angolanos ───────────────────────── */

/**
 * Normaliza para o formato internacional 2449XXXXXXXX.
 * Aceita 9XXXXXXXX, +2449XXXXXXXX, 2449XXXXXXXX, com espaços/traços.
 * Retorna null se inválido (não é número angolano válido).
 */
export function normalizeAngolanPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  let national: string | null = null;

  if (digits.length === 9 && digits.startsWith('9')) national = digits;
  else if (digits.length === 12 && digits.startsWith('244')) national = digits.slice(3);
  else if (digits.length === 13 && digits.startsWith('2440')) national = digits.slice(4);

  if (!national || !/^9[1-9]\d{7}$/.test(national)) return null;
  return `244${national}`;
}

/* ──────────────────────────── Webhooks HMAC ────────────────────────── */

/** Verifica assinatura HMAC-SHA256 (hex) de um webhook — timing-safe. */
export function verifyHmacSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase().replace(/^sha256=/, ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
