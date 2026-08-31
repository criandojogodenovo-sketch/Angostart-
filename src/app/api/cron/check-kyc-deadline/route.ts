import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/cron/check-kyc-deadline (Fase 13) — tarefa agendada diária
 * (Vercel Cron) que aplica a regra de carência de 30 dias do KYC:
 *
 *  1. Procura vendedores com kyc_deadline < NOW() e kyc_status IN
 *     ('not_submitted', 'pending') — prazo expirado sem documento válido.
 *  2. kyc_status → 'overdue': ficam EM SUPERVISÃO — não publicam NOVOS
 *     produtos (as vendas existentes continuam), aparecem na fila do admin.
 *  3. Envia email + notificação in-app a avisar (UMA vez por ciclo —
 *     kyc_overdue_notified_at evita spam diário; o admin pode reenviar).
 *
 * Segurança da fila:
 *  - Submissão de documento (POST /api/kyc/submit) limpa kyc_deadline —
 *    quem cumpriu a carência nunca é marcado como overdue.
 *  - Admin: «Aceitar justificação» devolve a conta a 'not_submitted' com
 *    nova janela de 30 dias; «Reenviar aviso» repete o email; «Bloquear
 *    conta» bloqueia o login (users.blocked).
 *
 * 🔒 Proteção: `Authorization: Bearer $CRON_SECRET` (igual ao daily-codes e
 *    gamification). Em dev (sem CRON_SECRET) o POST é permitido para testes.
 */

interface OverdueSeller {
  id: number;
  name: string;
  email: string;
  kyc_status: string;
  kyc_deadline: string;
}

/** Núcleo reutilizável (GET do Vercel Cron + POST manual/admin). */
async function runDeadlineCheck() {
  const expired = (await sql`
    SELECT id, name, email, kyc_status, kyc_deadline
    FROM users
    WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
      AND kyc_deadline IS NOT NULL
      AND kyc_deadline < NOW()
      AND kyc_status IN ('not_submitted', 'pending')
      AND blocked = FALSE
    LIMIT 500
  `) as unknown as OverdueSeller[];

  let marcados = 0;
  let notificados = 0;
  let emails = 0;

  for (const seller of expired) {
    /* Transição para overdue (idempotente — só muda quem ainda estava
       not_submitted/pending; corrida com a submissão é inofensiva: se o
       vendedor submeteu entretanto, o UPDATE ... AND kyc_status IN (…)
       já não faz nada e kyc_deadline está NULL). */
    const updated = (await sql`
      UPDATE users
      SET kyc_status = 'overdue'
      WHERE id = ${seller.id}
        AND kyc_status IN ('not_submitted', 'pending')
        AND kyc_deadline IS NOT NULL
        AND kyc_deadline < NOW()
      RETURNING id, kyc_overdue_notified_at::text
    `) as unknown as { id: number; kyc_overdue_notified_at: string | null }[];

    if (!updated[0]) continue;
    marcados += 1;

    const primeiraVez = !updated[0].kyc_overdue_notified_at;

    /* Notificação in-app (barata — sempre que entra em overdue). */
    try {
      await sql`
        INSERT INTO notifications (user_id, title, body, link)
        VALUES (
          ${seller.id},
          'Prazo de verificação de identidade expirou',
          ${'O prazo de 30 dias para enviar o teu documento de identidade terminou. A publicação de novos produtos está bloqueada — envia o documento no Painel de vendas para desbloqueares.'},
          '/dashboard/vendedor'
        )`;
    } catch {
      /* notificação best-effort */
    }

    /* Email de aviso apenas na PRIMEIRA entrada em overdue (sem spam). */
    if (primeiraVez) {
      notificados += 1;
      const enviado = await sendMail({
        to: seller.email,
        subject: 'Prazo de verificação expirado — envia o teu documento — AngoStart',
        html: `
          <div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">
            <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8f0">
              <h2 style="margin:0 0 8px;color:#0f172a">Ango<span style="color:#10b981">Start</span></h2>
              <p style="color:#0f172a">Olá ${seller.name},</p>
              <p style="color:#0f172a">
                O prazo de <strong>30 dias</strong> para enviares a foto do teu documento de
                identidade (BI, Passaporte ou Cartão de Eleitor) terminou.
              </p>
              <div style="margin:12px 0;padding:14px;border:1px solid #f59e0b;border-radius:12px;background:#fffbeb">
                <p style="margin:0;color:#92400e;font-weight:bold">⚠️ A publicação de novos produtos está temporariamente bloqueada.</p>
                <p style="margin:6px 0 0;color:#92400e;font-size:14px">
                  As tuas vendas e encomendas existentes continuam normais. Basta enviares o
                  documento para voltar a publicar — a conta é desbloqueada automaticamente.
                </p>
              </div>
              <p><a href="${getAppUrl()}/dashboard/vendedor" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:bold">
                Enviar documento agora →
              </a></p>
              <p style="font-size:13px;color:#64748b">
                Se acreditas que isto é um erro, responde a este email — a equipa AngoStart
                pode aceitar a tua justificação e reabrir o prazo.
              </p>
            </div>
          </div>`,
      }).catch(() => false);
      if (enviado) emails += 1;

      await sql`
        UPDATE users SET kyc_overdue_notified_at = NOW() WHERE id = ${seller.id}
      `;
    }
  }

  return { analisados: expired.length, marcados, notificados, emails };
}

/** Autorização partilhada GET/POST — padrão do /api/cron/gamification. */
function authorizeCron(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (cronSecret) {
    if (bearer !== cronSecret) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET não configurada — cron desativado em produção.' },
      { status: 403 }
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runDeadlineCheck();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[API cron/check-kyc-deadline] Erro no GET:', error);
    return NextResponse.json({ error: 'Falha na verificação de prazos.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runDeadlineCheck();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[API cron/check-kyc-deadline] Erro no POST:', error);
    return NextResponse.json({ error: 'Falha na verificação de prazos.' }, { status: 503 });
  }
}
