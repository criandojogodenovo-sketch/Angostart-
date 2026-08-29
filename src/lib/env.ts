import 'server-only';
import { z } from 'zod';

/**
 * AngoStart — Validação de variáveis de ambiente (apenas servidor).
 *
 * - `import 'server-only'` garante que este módulo NUNCA entra no bundle
 *   de um Client Component: se o fizer, o build falha imediatamente.
 * - As chaves secretas (JWT_SECRET, DATABASE_URL, RESEND_API_KEY)
 *   vivem exclusivamente no servidor (.env.local em dev,
 *   Environment Variables da Vercel em produção).
 * - Pagamentos: KWiK é um pagamento MANUAL por transferência — não
 *   existe gateway externo nem chaves de API de pagamentos.
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

  /** Email do administrador — recebe alertas de validações de pagamento. */
  ADMIN_EMAIL: z.string().email().optional(),

  /** Segredo do cron (Vercel Cron envia `Authorization: Bearer $CRON_SECRET`). */
  CRON_SECRET: z.string().min(16).optional(),

  /** Reserva para gateway de pagamentos futuro (placeholder na Fase 4). */
  MOMENU_API_KEY: z.string().min(1).optional(),

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
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || undefined,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    MOMENU_API_KEY: process.env.MOMENU_API_KEY || undefined,
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
