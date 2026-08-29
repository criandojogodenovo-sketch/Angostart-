import 'server-only';
import { sql } from '@/lib/db';
import { pushNotification } from '@/lib/notifications';
import { getEnv } from '@/lib/env';

/**
 * AngoStart — Sistema ANTI-BURLA e monitorização (Fase 5) — server-side.
 *
 * Regras automáticas:
 *  1. tentativa_fora      — partilha de contactos (email/telefone/WhatsApp)
 *                           no chat para negociar fora da plataforma.
 *  2. ciclo_deposito_saque — 3 depósitos + 3 saques com valores idênticos
 *                           em menos de 24 h (lavagem / teste de cartão).
 *  3. reclamacoes_cliente  — 2 reclamações (avaliações ≤ 2★) → supervisão.
 *
 * Ações: após 2 atividades suspeitas ABERTAS, a conta é BLOQUEADA
 * temporariamente e o admin total é notificado (sino + email). O admin
 * pode desbloquear manualmente ou banir permanentemente no painel.
 */

export type SuspiciousSeverity = 'baixa' | 'media' | 'alta';

export interface SuspiciousRow {
  id: number;
  user_id: number;
  action: string;
  details: string | null;
  severity: string;
  status: string;
  created_at: string;
  user_name?: string | null;
  user_email?: string | null;
  user_blocked?: boolean;
}

/** Padrões de contactos — emails, telefones angolanos/internacionais, links wa.me/t.me. */
const CONTACT_PATTERNS: RegExp[] = [
  /[a-z0-9._%+-]+\s*(?:@|\s*\(at\)\s*|\s*\[arroba\]\s*)\s*[a-z0-9.-]+\s*\.\s*[a-z]{2,}/gi,
  /(?:\+?244|00244)?\s*9[1-9](?:[\s.-]?\d){7}/g,
  /\b9[0-9]{8}\b/g,
  /wa\.me\/\d+/gi,
  /t\.me\/[a-z0-9_]+/gi,
  /whats?app/gi,
];

/** Deteta partilha de contactos num texto do chat. Devolve os tipos encontrados. */
export function detectContactSharing(text: string): string[] {
  const found: string[] = [];
  for (const pattern of CONTACT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      found.push(pattern.source.slice(0, 40));
    }
  }
  return found;
}

/**
 * Regista atividade suspeita e aplica a regra dos 2 avisos:
 * 2 atividades ABERTAS → conta bloqueada + notificações ao admin.
 * Melhor-esforço: erros nunca devem quebrar o fluxo chamador.
 */
export async function logSuspiciousActivity(input: {
  userId: number;
  action: string;
  details?: string | null;
  severity?: SuspiciousSeverity;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO suspicious_activities (user_id, action, details, severity)
      VALUES (${input.userId}, ${input.action}, ${input.details?.slice(0, 500) ?? null},
              ${input.severity ?? 'media'})
    `;

    const open = (await sql`
      SELECT count(*)::int AS n
      FROM suspicious_activities
      WHERE user_id = ${input.userId} AND status = 'aberta'
    `) as unknown as { n: number }[];
    const openCount = open[0]?.n ?? 0;

    if (openCount >= 2) {
      // Bloqueio temporário — o admin decide desbloquear ou banir.
      await sql`
        UPDATE users SET blocked = TRUE WHERE id = ${input.userId} AND blocked = FALSE
      `;
      await pushNotification(
        input.userId,
        'Conta bloqueada temporariamente',
        'Detetámos atividades suspeitas na tua conta. Contacta o suporte pelo WhatsApp para resolver.',
        '/perfil'
      );
      await notifyAdminSuspicious(input.userId, openCount, input.action);
    }
  } catch (error) {
    console.error('[antifraud] Falha ao registar atividade suspeita:', error);
  }
}

/** Alerta o admin total (sino + email) quando uma conta é bloqueada. */
async function notifyAdminSuspicious(userId: number, openCount: number, action: string) {
  try {
    const admins = (await sql`
      SELECT id, email FROM users WHERE role = 'admin' AND blocked = FALSE
    `) as unknown as { id: number; email: string }[];

    for (const admin of admins) {
      await pushNotification(
        admin.id,
        'Conta bloqueada automaticamente',
        `Utilizador #${userId} tem ${openCount} atividades suspeitas (última: ${action}). Revisa no painel → Monitorização.`,
        '/admin?tab=monitorizacao'
      );
    }

    // Email melhor-esforço (usa ADMIN_EMAIL)
    try {
      const adminEmail = getEnv().ADMIN_EMAIL;
      if (adminEmail) {
        const { sendAdminAlertEmail } = await import('@/lib/email');
        await sendAdminAlertEmail(
          `Conta #${userId} bloqueada automaticamente`,
          `<p>A conta <strong>#${userId}</strong> foi bloqueada após ${openCount}
           atividades suspeitas (última ação: <strong>${action}</strong>).</p>
           <p>Revisa e decide no painel de administração → <strong>Monitorização</strong>.</p>`
        );
      }
    } catch {
      /* email opcional */
    }
  } catch (error) {
    console.error('[antifraud] Falha ao notificar admin:', error);
  }
}

/**
 * Regra 2 — ciclo depósito→saque: 3 depósitos E 3 saques com valores
 * idênticos nas últimas 24 h. Corre a cada depósito/saque novo.
 */
export async function checkDepositWithdrawLoop(userId: number): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT tipo, valor::float8 AS valor, count(*)::int AS n
      FROM wallet_transactions
      WHERE user_id = ${userId}
        AND tipo IN ('deposito', 'saque')
        AND status IN ('pendente', 'concluido')
        AND created_at >= now() - interval '24 hours'
      GROUP BY tipo, valor
    `) as unknown as { tipo: string; valor: number; n: number }[];

    const matched = new Map<number, { dep: number; saq: number }>();
    for (const r of rows) {
      const entry = matched.get(Number(r.valor)) ?? { dep: 0, saq: 0 };
      if (r.tipo === 'deposito') entry.dep += Number(r.n);
      else entry.saq += Number(r.n);
      matched.set(Number(r.valor), entry);
    }

    for (const [valor, counts] of matched) {
      if (counts.dep >= 3 && counts.saq >= 3) {
        await logSuspiciousActivity({
          userId,
          action: 'ciclo_deposito_saque',
          details: `3+ depósitos e 3+ saques de ${valor} Kz em menos de 24 h.`,
          severity: 'alta',
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('[antifraud] checkDepositWithdrawLoop falhou:', error);
    return false;
  }
}

/**
 * Regra 3 — reclamações de clientes: 2 avaliações ≤ 2★ nos produtos do
 * vendedor → conta marcada para supervisão manual (atividade suspeita).
 */
export async function checkSellerComplaints(sellerId: number): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${sellerId} AND r.rating <= 2
    `) as unknown as { n: number }[];
    const complaints = rows[0]?.n ?? 0;

    if (complaints >= 2) {
      const existing = (await sql`
        SELECT 1 FROM suspicious_activities
        WHERE user_id = ${sellerId} AND action = 'reclamacoes_cliente'
          AND created_at >= now() - interval '7 days'
        LIMIT 1
      `) as unknown as unknown[];
      if (existing.length === 0) {
        await logSuspiciousActivity({
          userId: sellerId,
          action: 'reclamacoes_cliente',
          details: `${complaints} reclamações de clientes (avaliações ≤ 2★) — conta sob supervisão manual.`,
          severity: 'media',
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('[antifraud] checkSellerComplaints falhou:', error);
    return false;
  }
}

/** Lista atividades para o painel admin (com dados do utilizador). */
export async function listSuspiciousActivities(
  status: string | null,
  limit = 50
): Promise<SuspiciousRow[]> {
  const base = sql`
    SELECT s.id, s.user_id, s.action, s.details, s.severity, s.status, s.created_at,
           u.name AS user_name, u.email AS user_email, u.blocked::boolean AS user_blocked
    FROM suspicious_activities s
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${limit}
  `;
  const filtered = sql`
    SELECT s.id, s.user_id, s.action, s.details, s.severity, s.status, s.created_at,
           u.name AS user_name, u.email AS user_email, u.blocked::boolean AS user_blocked
    FROM suspicious_activities s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status = ${status ?? 'aberta'}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${limit}
  `;
  const rows = (await (status ? filtered : base)) as unknown as SuspiciousRow[];
  return rows;
}
