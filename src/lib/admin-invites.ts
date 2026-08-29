import 'server-only';
import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';

/**
 * AngoStart — Administração dinâmica (server-side).
 *
 * Substitui as contas de admin_limitado com senha fixa por:
 *  1. CONVITE — o admin total convida um email; o sistema gera um código
 *     de 8 caracteres (24 h de validade) enviado por email (Resend).
 *     O convidado cria a conta em /admin-limitado com email + código.
 *  2. CÓDIGO DIÁRIO — OTP de 6 dígitos, gerado todos os dias (cron 00:00
 *     em África/Luanda ou a pedido), enviado por email, expira em 24 h
 *     e só pode ser usado UMA vez. Exigido no login diário + 2FA.
 *
 * 🔒 Segurança:
 *  - Códigos NUNCA são guardados em texto claro — apenas HMAC-SHA256
 *    com "pepper" JWT_SECRET (comparação timing-safe).
 *  - Alfabeto sem caracteres ambíguos (0/O/1/I/L) nos convites.
 *  - Geração com crypto.randomInt (sem enviesamento de módulo).
 *  - Auditoria de todos os eventos em admin_audit.
 */

/* ─────────────────────────── Geração de códigos ────────────────────── */

/** Alfabeto sem 0/O/1/I/L — evita confusões ao ler o código recebido. */
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;
export const DAILY_CODE_LENGTH = 6;

/** Código de convite: 8 caracteres criptograficamente aleatórios. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
  }
  return code;
}

/** Código diário: 6 dígitos (000000–999999) com aleatoriedade criptográfica. */
export function generateDailyCodeValue(): string {
  return String(randomInt(0, 1_000_000)).padStart(DAILY_CODE_LENGTH, '0');
}

/* ─────────────────────── Hash com pepper JWT_SECRET ────────────────── */

function pepper(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ausente — impossível encriptar códigos admin.');
  }
  return secret;
}

/** HMAC-SHA256(código, pepper=JWT_SECRET) → hex. Guardado na BD, nunca o código. */
export function hashCode(code: string): string {
  return createHmac('sha256', pepper()).update(`angostart:${code}`, 'utf8').digest('hex');
}

/** Comparação timing-safe entre o hash do código submetido e o guardado. */
export function codesMatch(code: string, storedHash: string): boolean {
  const submitted = Buffer.from(hashCode(code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (submitted.length !== stored.length) return false;
  return timingSafeEqual(submitted, stored);
}

/* ─────────────────────────── Datas (Luanda, UTC+1) ─────────────────── */

/** Data de "hoje" em África/Luanda, formato YYYY-MM-DD (chave do código diário). */
export function luandaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Luanda',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Validade padrão de códigos (convite e diário): 24 h. */
function expires24h(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

/* ─────────────────────────────── Auditoria ─────────────────────────── */

export interface AuditEntry {
  userId?: number | null;
  email?: string | null;
  event: string;
  detail?: string;
  ip?: string | null;
}

/** Registra um evento de segurança em admin_audit (nunca lança). */
export async function logAdminAudit(entry: AuditEntry): Promise<void> {
  try {
    await sql`
      INSERT INTO admin_audit (user_id, email, event, detail, ip)
      VALUES (
        ${entry.userId ?? null},
        ${entry.email ?? null},
        ${entry.event},
        ${entry.detail?.slice(0, 300) ?? null},
        ${entry.ip ?? null}
      )
    `;
  } catch (error) {
    console.error('[admin-audit] Falha ao registar evento:', error);
  }
}

/* ────────────────────────────── Convites ───────────────────────────── */

export interface InviteRow {
  id: number;
  email: string;
  name: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza e valida um email de convite. */
export function normalizeInviteEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/**
 * Cria (ou reemite) um convite para email indicado — código de 8 caracteres
 * com validade de 24 h. Devolve o código EM TEXTO CLARO apenas para envio
 * por email / resposta ao admin quando o email falha.
 */
export async function createInvite(
  email: string,
  name: string | null,
  createdBy: number
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateInviteCode();
  const expiresAt = expires24h();

  await sql`
    INSERT INTO admin_invites (email, name, code_hash, expires_at, created_by)
    VALUES (${email}, ${name}, ${hashCode(code)}, ${expiresAt.toISOString()}, ${createdBy})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          code_hash = EXCLUDED.code_hash,
          expires_at = EXCLUDED.expires_at,
          accepted_at = NULL,
          created_by = EXCLUDED.created_by,
          created_at = NOW()
  `;
  return { code, expiresAt };
}

export type AcceptInviteResult =
  | { ok: true; user: { id: number; name: string; email: string; role: 'admin_limitado' } }
  | { ok: false; reason: 'invalid' | 'expired' | 'account_exists' | 'already_accepted' };

/**
 * Valida email + código de convite e cria a conta admin_limitado.
 * A conta nasce SEM senha utilizável (login diário é por código + 2FA).
 */
export async function acceptInvite(
  email: string,
  code: string
): Promise<AcceptInviteResult> {
  const rows = (await sql`
    SELECT id, name, code_hash, expires_at, accepted_at
    FROM admin_invites WHERE email = ${email} LIMIT 1
  `) as unknown as {
    id: number;
    name: string | null;
    code_hash: string;
    expires_at: string;
    accepted_at: string | null;
  }[];

  const invite = rows[0];
  if (!invite) return { ok: false, reason: 'invalid' };

  // Comparação sempre executada (mesmo sem convite) para reduzir timing leaks
  if (!codesMatch(code, invite.code_hash)) return { ok: false, reason: 'invalid' };
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (invite.accepted_at) return { ok: false, reason: 'already_accepted' };

  // A conta já pode existir (ex.: convite aceite, código reutilizado)
  const existing = (await sql`
    SELECT id, name, email, role FROM users WHERE email = ${email} LIMIT 1
  `) as unknown as { id: number; name: string; email: string; role: string }[];
  if (existing.length > 0) {
    return existing[0].role === 'admin_limitado'
      ? { ok: false, reason: 'already_accepted' }
      : { ok: false, reason: 'account_exists' };
  }

  const displayName = invite.name?.trim() || email.split('@')[0];
  // Palavra-passe aleatória de 48 bytes — ninguém a conhece; login real é
  // por código diário + 2FA. bcrypt torna-a irrecuperável.
  const unusableHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 10);
  const usernameBase =
    displayName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 20) || 'validador';
  const username = `${usernameBase}-${randomBytes(2).toString('hex')}`;

  const inserted = (await sql`
    INSERT INTO users (name, email, password_hash, role, username)
    VALUES (${displayName}, ${email}, ${unusableHash}, 'admin_limitado', ${username})
    RETURNING id, name, email, role
  `) as unknown as { id: number; name: string; email: string; role: 'admin_limitado' }[];

  await sql`
    UPDATE admin_invites SET accepted_at = NOW() WHERE id = ${invite.id}
  `;
  return { ok: true, user: inserted[0] };
}

/* ──────────────────────────── Códigos diários ──────────────────────── */

/**
 * Gera (ou roda) o código diário do admin limitado para HOJE em Luanda.
 * Se já existia um código hoje, é INVALIDADO e substituído (permite
 * "reenviar" sem violar o armazenamento com hash).
 * Devolve o código em texto claro apenas para envio por email.
 */
export async function rotateDailyCode(
  adminId: number
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateDailyCodeValue();
  const today = luandaToday();
  const expiresAt = expires24h();

  await sql`
    INSERT INTO admin_daily_codes (admin_id, code_hash, date, expires_at)
    VALUES (${adminId}, ${hashCode(code)}, ${today}, ${expiresAt.toISOString()})
    ON CONFLICT (admin_id, date) DO UPDATE
      SET code_hash = EXCLUDED.code_hash,
          expires_at = EXCLUDED.expires_at,
          used_at = NULL
  `;
  return { code, expiresAt };
}

export type DailyCodeRow = {
  id: number;
  admin_id: number;
  admin_email: string;
  date: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type VerifyDailyResult =
  | { ok: true; user: { id: number; name: string; email: string; role: 'admin_limitado' } }
  | { ok: false; reason: 'no_account' | 'blocked' | 'no_code' | 'invalid' | 'used' | 'expired' };

/**
 * Verifica o código diário no login (email + código).
 * 'no_code' → ainda não há código hoje: a rota deve gerar e enviar por email.
 */
export async function verifyDailyCode(
  email: string,
  code: string
): Promise<VerifyDailyResult> {
  const users = (await sql`
    SELECT id, name, email, role, blocked::boolean AS blocked
    FROM users WHERE email = ${email} LIMIT 1
  `) as unknown as {
    id: number;
    name: string;
    email: string;
    role: string;
    blocked: boolean;
  }[];

  const user = users[0];
  if (!user || user.role !== 'admin_limitado') return { ok: false, reason: 'no_account' };
  if (user.blocked) return { ok: false, reason: 'blocked' };

  const rows = (await sql`
    SELECT id, code_hash, expires_at, used_at
    FROM admin_daily_codes
    WHERE admin_id = ${user.id} AND date = ${luandaToday()}
    LIMIT 1
  `) as unknown as {
    id: number;
    code_hash: string;
    expires_at: string;
    used_at: string | null;
  }[];

  const record = rows[0];
  if (!record) return { ok: false, reason: 'no_code' };

  if (!codesMatch(code, record.code_hash)) return { ok: false, reason: 'invalid' };
  if (record.used_at) return { ok: false, reason: 'used' };
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  await sql`UPDATE admin_daily_codes SET used_at = NOW() WHERE id = ${record.id}`;
  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: 'admin_limitado' },
  };
}

/* ───────────────────────── Listagens para o painel ─────────────────── */

/** Convites (estado calculado no cliente: pendente/aceite/expirado). */
export async function listInvites(): Promise<InviteRow[]> {
  return (await sql`
    SELECT i.id, i.email, i.name, i.expires_at, i.accepted_at, i.created_at,
           u.email AS created_by_email
    FROM admin_invites i
    LEFT JOIN users u ON u.id = i.created_by
    ORDER BY i.created_at DESC
    LIMIT 100
  `) as unknown as InviteRow[];
}

/** Contas admin_limitado ativas (para "Gerir Admins Limitados"). */
export async function listLimitedAdmins(): Promise<
  {
    id: number;
    name: string;
    email: string;
    blocked: boolean;
    two_factor_enabled: boolean;
    whatsapp_contact: string | null;
    created_at: string;
  }[]
> {
  return (await sql`
    SELECT id, name, email, blocked::boolean AS blocked,
           two_factor_enabled::boolean AS two_factor_enabled,
           whatsapp_contact, created_at
    FROM users WHERE role = 'admin_limitado'
    ORDER BY created_at DESC
  `) as unknown as {
    id: number;
    name: string;
    email: string;
    blocked: boolean;
    two_factor_enabled: boolean;
    whatsapp_contact: string | null;
    created_at: string;
  }[];
}

/** Histórico recente de códigos diários (hashes nunca expostos). */
export async function listDailyCodes(): Promise<DailyCodeRow[]> {
  return (await sql`
    SELECT c.id, c.admin_id, u.email AS admin_email, c.date::text AS date,
           c.expires_at, c.used_at, c.created_at
    FROM admin_daily_codes c
    JOIN users u ON u.id = c.admin_id
    ORDER BY c.date DESC, c.created_at DESC
    LIMIT 50
  `) as unknown as DailyCodeRow[];
}

/** Remove um convite pendente (admin total). */
export async function deleteInvite(inviteId: number): Promise<boolean> {
  const deleted = (await sql`
    DELETE FROM admin_invites WHERE id = ${inviteId} RETURNING id
  `) as unknown as { id: number }[];
  return deleted.length > 0;
}

/** Remove uma conta admin_limitado e os seus códigos (admin total). */
export async function deleteLimitedAdmin(userId: number): Promise<boolean> {
  const deleted = (await sql`
    DELETE FROM users WHERE id = ${userId} AND role = 'admin_limitado' RETURNING id
  `) as unknown as { id: number }[];
  return deleted.length > 0;
}
