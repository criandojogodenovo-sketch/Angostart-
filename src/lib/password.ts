/**
 * AngoStart — Validação de senhas fortes (Fase 9).
 *
 * ⚡ Client-safe: sem `import 'server-only'` — é usado tanto no servidor
 * (POST /api/auth/register/*, /api/auth/change-password) como no cliente
 * (medidor de força em tempo real na página de registo). O servidor SEMPRE
 * revalida — a validação no cliente é apenas UX.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Senhas proibidas (top passwords + variações da marca). */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'passw0rd', 'qwerty123', 'qwertyuiop', 'abc123456', 'iloveyou1', 'admin1234',
  'angostart', 'angostart1', 'angostart123', 'angola123', 'luanda123',
  '11111111', '00000000', '12121212', '12341234', '11223344', 'a1b2c3d4',
  'letmein12', 'welcome1', 'monkey123', 'dragon123', 'master123', 'login1234',
  'senha1234', 'palavrachave', 'teclado123', 'internet1', 'samsung123',
  'facebook1', 'google123', 'youtube123', 'whatsapp12', 'unitel1234',
  'asdf1234', 'zxcvbnm1', 'qazwsx123', '1q2w3e4r5t', '1qaz2wsx3e',
]);

export interface PasswordValidation {
  ok: boolean;
  /** Mensagem de erro clara (quando ok = false). */
  error?: string;
}

/** Senhas comuns (base) — a comparação ignora dígitos/símbolos finais,
 *  apanha variações como «Password1!», «Qwerty123», «Admin2024», etc. */
const COMMON_BASE_WORDS = new Set([
  'password', 'passw0rd', 'passwort', 'senha', 'contrasena',
  'qwerty', 'azerty', 'qwertz', 'asdfgh', 'zxcvbnm',
  'abc', 'iloveyou', 'admin', 'administrator', 'root', 'login',
  'angostart', 'angola', 'luanda', 'kwanza', 'unitel', 'africell',
  'letmein', 'welcome', 'monkey', 'dragon', 'master', 'sunshine',
  'teclado', 'internet', 'facebook', 'google', 'youtube', 'whatsapp',
  'samsung', 'apple', 'android', 'nossa', 'saude', 'escola',
]);

/** Base alfabética da senha (só letras, minúsculas, sem acentos). */
function passwordBase(p: string): string {
  return p
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Rejeita padrões triviais de teclado e sequências numéricas longas. */
function looksTrivial(p: string): boolean {
  const lower = p.toLowerCase();
  if (/^(?:012|123|234|345|456|567|678|789)+\d*$/.test(lower)) return true; // sequências
  if (/^(.)\1+$/.test(lower)) return true; // 111111, aaaaaa
  if (/^(?:qwer|asdf|zxcv)+.*$/.test(lower)) return true; // qwerty rows
  return false;
}

/** Regras: ≥8 caracteres · maiúscula · minúscula · número · símbolo. */
export function validatePassword(password: string): PasswordValidation {
  const p = password ?? '';
  if (p.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `A palavra-passe deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (!/[A-Z]/.test(p)) {
    return {
      ok: false,
      error: 'A palavra-passe deve ter pelo menos 1 letra maiúscula (A-Z).',
    };
  }
  if (!/[a-z]/.test(p)) {
    return {
      ok: false,
      error: 'A palavra-passe deve ter pelo menos 1 letra minúscula (a-z).',
    };
  }
  if (!/[0-9]/.test(p)) {
    return { ok: false, error: 'A palavra-passe deve ter pelo menos 1 número (0-9).' };
  }
  if (!/[^A-Za-z0-9]/.test(p)) {
    return {
      ok: false,
      error: 'A palavra-passe deve ter pelo menos 1 símbolo especial (ex.: !@#$%^&*).',
    };
  }
  if (COMMON_PASSWORDS.has(p.toLowerCase())) {
    return {
      ok: false,
      error: 'Esta palavra-passe é muito comum — escolhe outra mais segura.',
    };
  }
  const base = passwordBase(p);
  if (base.length >= 3 && COMMON_BASE_WORDS.has(base)) {
    return {
      ok: false,
      error: 'Esta palavra-passe é muito comum — escolhe outra mais segura.',
    };
  }
  if (looksTrivial(p.toLowerCase())) {
    return {
      ok: false,
      error: 'Esta palavra-passe é demasiado previsível — escolhe outra mais segura.',
    };
  }
  return { ok: true };
}

/* ───────────────────────── Medidor de força (UI) ─────────────────────── */

export type PasswordStrengthLabel = 'fraca' | 'média' | 'forte';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3;
  label: PasswordStrengthLabel;
  /** Cor Tailwind da barra (cinza quando vazia). */
  color: string;
}

/**
 * Força para o indicador visual:
 *  critérios: comprimento ≥8 / ≥12, maiúscula+minúscula, número, símbolo,
 *  não-comum. 0-1 → fraca · 2 → média · 3+ → forte.
 */
export function passwordStrength(password: string): PasswordStrength {
  const p = password ?? '';
  if (p.length === 0) {
    return { score: 0, label: 'fraca', color: 'bg-slate-200' };
  }

  let crit = 0;
  if (p.length >= PASSWORD_MIN_LENGTH) crit += 1;
  if (p.length >= 12) crit += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) crit += 1;
  if (/[0-9]/.test(p)) crit += 1;
  if (/[^A-Za-z0-9]/.test(p)) crit += 1;
  if (!COMMON_PASSWORDS.has(p.toLowerCase()) && p.length >= PASSWORD_MIN_LENGTH) crit += 1;

  const score: 0 | 1 | 2 | 3 = crit <= 2 ? 1 : crit <= 4 ? 2 : 3;
  if (score === 1) return { score, label: 'fraca', color: 'bg-rose-500' };
  if (score === 2) return { score, label: 'média', color: 'bg-amber-500' };
  return { score, label: 'forte', color: 'bg-teal-500' };
}

/* ─────────────────────── BI angolano + idade mínima ─────────────────── */

/** BI angolano: 9 dígitos + 2-5 alfanuméricos (ex.: 004587896LA038). */
export const BI_REGEX = /^[0-9]{9}[A-Z0-9]{2,5}$/;

/** Idade mínima legal para vender na plataforma (prompts Fase 9). */
export const IDADE_MINIMA_VENDEDOR = 15;

/** Idade a partir de 'YYYY-MM-DD' (ou Date) — em anos completos. */
export function calcularIdade(birthDate: string | Date): number {
  const d = typeof birthDate === 'string' ? new Date(`${birthDate}T00:00:00Z`) : birthDate;
  if (Number.isNaN(d.getTime())) return -1;
  const agora = new Date();
  let idade = agora.getUTCFullYear() - d.getUTCFullYear();
  const m = agora.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && agora.getUTCDate() < d.getUTCDate())) idade -= 1;
  return idade;
}

export interface BiBirthValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valida BI + data de nascimento do vendedor (registo Fase 9).
 * BI normalizado (sem espaços/hífens, maiúsculas) e idade ≥ 15.
 */
export function validateBiAndBirth(
  biNumberRaw: string,
  birthDateRaw: string
): BiBirthValidation & { bi?: string; birthDate?: string } {
  const bi = (biNumberRaw ?? '').toUpperCase().replace(/[\s-]/g, '');
  const birth = (birthDateRaw ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(new Date(`${birth}T00:00:00Z`).getTime())) {
    return { ok: false, error: 'Indica a tua data de nascimento (AAAA-MM-DD).' };
  }
  const idade = calcularIdade(birth);
  if (idade < 0) {
    return { ok: false, error: 'Data de nascimento inválida.' };
  }
  if (idade < IDADE_MINIMA_VENDEDOR) {
    return { ok: false, error: 'Idade mínima para aderir como vendedor é 15 anos' };
  }
  if (idade > 120) {
    return { ok: false, error: 'Data de nascimento inválida — verifica o ano.' };
  }
  if (!BI_REGEX.test(bi)) {
    return {
      ok: false,
      error: 'BI inválido — usa o formato do documento (ex.: 004587896LA038).',
    };
  }
  return { ok: true, bi, birthDate: birth };
}
