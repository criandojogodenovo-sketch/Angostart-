import 'server-only';
import { z } from 'zod';

/**
 * AngoStart — Validação de variáveis de ambiente (apenas servidor).
 *
 * - `import 'server-only'` garante que este módulo NUNCA entra no bundle
 *   de um Client Component: se o fizer, o build falha imediatamente.
 * - As chaves secretas (JWT_SECRET, DATABASE_URL, RESEND_API_KEY,
 *   PAYPAY_*) vivem exclusivamente no servidor (.env.local em dev,
 *   Environment Variables da Vercel em produção).
 * - Variáveis públicas usam obrigatoriamente o prefixo NEXT_PUBLIC_
 *   (ex.: NEXT_PUBLIC_APP_URL) — tudo o resto é proibido no cliente.
 */

const serverEnvSchema = z.object({
  /** Base de dados Neon (PostgreSQL). */
  DATABASE_URL: z
    .string()
    .startsWith('postgres', 'DATABASE_URL deve ser uma connection string PostgreSQL'),
  /** Segredo de assinatura dos JWT (HS256). */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),

  /* ── Email (Resend) — opcionais: app funciona sem, email fica em modo dev ── */
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FROM: z.string().optional(),

  /* ── PayPay / Multicaixa Express — opcionais: sem chaves, modo sandbox ── */
  PAYPAY_PARTNER_ID: z.string().optional(),
  PAYPAY_PRIVATE_KEY: z.string().optional(),
  PAYPAY_PUBLIC_KEY: z.string().optional(),
  PAYPAY_WEBHOOK_SECRET: z.string().optional(),
  PAYPAY_API_URL: z.string().url().optional(),
  /** Email do administrador — recebe alertas de pagamentos/webhooks. */
  ADMIN_EMAIL: z.string().email().optional(),

  /* ── Público ── */
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

/**
 * Devolve as variáveis de ambiente validadas (com cache).
 * Lança um erro claro se falta alguma variável obrigatória ou se
 * JWT_SECRET for demasiado curta.
 */
export function getEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    PAYPAY_PARTNER_ID: process.env.PAYPAY_PARTNER_ID || undefined,
    PAYPAY_PRIVATE_KEY: process.env.PAYPAY_PRIVATE_KEY || undefined,
    PAYPAY_PUBLIC_KEY: process.env.PAYPAY_PUBLIC_KEY || undefined,
    PAYPAY_WEBHOOK_SECRET: process.env.PAYPAY_WEBHOOK_SECRET || undefined,
    PAYPAY_API_URL: process.env.PAYPAY_API_URL || undefined,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  });

  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Variáveis de ambiente inválidas:\n${detalhes}\n` +
        'Verifica o .env.local (dev) ou as Environment Variables da Vercel (produção).'
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** URL pública da app (para links em emails e CTA). */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}
