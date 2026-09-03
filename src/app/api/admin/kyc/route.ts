import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin, clientKey, rateLimit } from '@/lib/security';
import { sendMail } from '@/lib/email';
import { getAppUrl } from '@/lib/env';
import { KYC_GRACE_DAYS } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

/** Row comum das listas do admin. */
interface KycAdminRow {
  id: number;
  name: string;
  email: string;
  role: string;
  username: string | null;
  telefone: string | null;
  bi_number: string | null;
  nif_number: string | null;
  birth_date: string | null;
  kyc_status: string;
  is_verified_bi: boolean;
  kyc_document_url: string | null;
  kyc_document_type: string | null;
  kyc_rejection_reason: string | null;
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  /* Fase 13: prazo de carência + aviso de overdue */
  kyc_deadline: string | null;
  kyc_overdue_notified_at: string | null;
  blocked?: boolean;
}

const SELECT_FIELDS = `id, name, email, role, username, telefone,
  bi_number, nif_number, birth_date::text,
  kyc_status, is_verified_bi::boolean,
  kyc_document_url, kyc_document_type,
  kyc_rejection_reason,
  kyc_submitted_at, kyc_reviewed_at, created_at`.replace(/\s+/g, ' ');

/**
 * GET /api/admin/kyc (Fase 12 + Fase 13) — fila de verificação de identidade
 * orientada a FOTOS do documento (BI, Passaporte, Cartão de Eleitor).
 *
 * Devolve vendedores por estado:
 *  - pending   → documento submetido, à espera de revisão (foto visível
 *                pelo admin via /api/kyc/document — rota autorizada).
 *  - verified  → aprovados (selo azul ativo).
 *  - rejected  → recusados (publicação bloqueada até reenvio).
 *  - overdue   → (Fase 13) prazo de 30 dias expirou sem documento — em
 *                SUPERVISÃO: não publicam novos produtos; ações de
 *                Reenviar aviso / Aceitar justificação / Bloquear conta.
 *  - stats     → not_submitted (sem documento), sem_data_nascimento
 *                (admin deve pedir a data na revisão — idade ≥ 15) e
 *                overdue (em supervisão).
 * 🔒 Apenas admin / admin_limitado.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'admin-kyc-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const rows = (await sql.query(
      `SELECT ${SELECT_FIELDS}, kyc_deadline, kyc_overdue_notified_at
       FROM users
       WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
         AND kyc_status IN ('pending', 'verified', 'rejected', 'overdue')
       ORDER BY
         CASE kyc_status WHEN 'pending' THEN 0 WHEN 'overdue' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
         COALESCE(kyc_submitted_at, kyc_deadline, created_at) DESC
       LIMIT 200`
    )) as unknown as KycAdminRow[];

    const statsRows = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE kyc_status = 'not_submitted')::int AS not_submitted,
        COUNT(*) FILTER (WHERE kyc_status = 'overdue')::int AS overdue,
        COUNT(*) FILTER (WHERE kyc_status IN ('pending', 'not_submitted') AND birth_date IS NULL)::int AS sem_data_nascimento
      FROM users
      WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
    `) as unknown as { not_submitted: number; overdue: number; sem_data_nascimento: number }[];

    return NextResponse.json({
      pending: rows.filter((r) => r.kyc_status === 'pending'),
      overdue: rows.filter((r) => r.kyc_status === 'overdue'),
      verified: rows.filter((r) => r.kyc_status === 'verified'),
      rejected: rows.filter((r) => r.kyc_status === 'rejected'),
      stats: {
        not_submitted: statsRows[0]?.not_submitted ?? 0,
        overdue: statsRows[0]?.overdue ?? 0,
        sem_data_nascimento: statsRows[0]?.sem_data_nascimento ?? 0,
      },
    });
  } catch (error) {
    console.error('[API admin/kyc] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar a fila de verificação.' },
      { status: 503 }
    );
  }
}

/**
 * POST /api/admin/kyc (Fase 12 + Fase 13) — ações sobre o estado KYC.
 *
 * Fase 12 — decisão sobre o DOCUMENTO (foto do BI/Passaporte/Cartão):
 * Corpo: { user_id, action: 'aprovar' | 'rejeitar', note? }
 *  - aprovar  → kyc_status = 'verified' + is_verified_bi = TRUE
 *               (selo azul no perfil, loja e produtos).
 *  - rejeitar → kyc_status = 'rejected' + kyc_rejection_reason = note
 *               (publicação de NOVOS produtos bloqueada até o vendedor
 *               submeter nova foto; o documento anterior fica guardado
 *               para referência da equipa).
 *
 * Fase 13 — supervisão de vendedores OVERDUE (prazo de 30 dias expirado):
 * Corpo: { user_id, action: 'avisar' | 'aceitar_justificacao' | 'bloquear', note? }
 *  - avisar               → reenvia o email/notificação de prazo expirado
 *                           (kyc_overdue_notified_at carimbado de novo).
 *  - aceitar_justificacao → anula a supervisão: 'overdue' → 'not_submitted'
 *                           com NOVA janela de 30 dias (kyc_deadline =
 *                           NOW() + KYC_GRACE_DAYS) — volta a publicar.
 *  - bloquear             → blocked = TRUE: impede login e vendas
 *                           (reversível pelo painel de utilizadores).
 *
 * Todas as ações: email ao vendedor quando aplicável + notificação in-app.
 * 🔒 Apenas admin / admin_limitado.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'admin-kyc-post'), 30, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  let body: { user_id?: unknown; action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const userId = Number(body.user_id);
  const ACAO_VALIDA = ['aprovar', 'rejeitar', 'avisar', 'aceitar_justificacao', 'bloquear'] as const;
  type Acao = (typeof ACAO_VALIDA)[number];
  const action = (ACAO_VALIDA as readonly string[]).includes(String(body.action))
    ? (body.action as Acao)
    : null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;

  if (!Number.isInteger(userId) || userId <= 0 || !action) {
    return NextResponse.json(
      { error: 'Indica user_id e action («aprovar», «rejeitar», «avisar», «aceitar_justificacao» ou «bloquear»).' },
      { status: 400 }
    );
  }
  if (action === 'rejeitar' && !note) {
    return NextResponse.json(
      { error: 'Indica o motivo da rejeição — o vendedor recebe-o por email e precisa de saber o que corrigir.' },
      { status: 400 }
    );
  }

  try {
    const target = (await sql`
      SELECT id, name, email, kyc_status, blocked::boolean FROM users
      WHERE id = ${userId} AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
      LIMIT 1
    `) as unknown as { id: number; name: string; email: string; kyc_status: string; blocked: boolean }[];

    if (!target[0]) {
      return NextResponse.json({ error: 'Vendedor não encontrado.' }, { status: 404 });
    }

    let titulo = '';
    let corpo = '';
    let emailAssunto = '';
    let emailCorpo = '';

    if (action === 'aprovar') {
      await sql`
        UPDATE users
        SET kyc_status = 'verified', is_verified_bi = TRUE,
            kyc_reviewed_at = NOW(), kyc_reviewed_by = ${auth.user.id},
            kyc_rejection_reason = NULL,
            bi_verified_at = NOW(), bi_verified_by = ${auth.user.id}
        WHERE id = ${userId}
      `;
      titulo = 'Identidade verificada ✓';
      corpo =
        'O teu documento foi aprovado — já tens o selo azul de vendedor verificado no perfil, loja e produtos. Boas vendas!';
      emailAssunto = `${titulo} — AngoStart`;
      emailCorpo = corpo;
    } else if (action === 'rejeitar') {
      await sql`
        UPDATE users
        SET kyc_status = 'rejected', is_verified_bi = FALSE,
            kyc_reviewed_at = NOW(), kyc_reviewed_by = ${auth.user.id},
            kyc_rejection_reason = ${note}
        WHERE id = ${userId}
      `;
      titulo = 'Verificação de identidade recusada';
      corpo = `O teu documento de identidade não foi validado. Motivo: ${note} A publicação de novos produtos fica bloqueada até enviares um novo documento no Painel de vendas → Verificação de Identidade.`;
      emailAssunto = `${titulo} — AngoStart`;
      emailCorpo = corpo;
    } else if (action === 'avisar') {
      /* Fase 13: reenvio do aviso de prazo expirado (vendedor continua overdue). */
      if (target[0].kyc_status !== 'overdue') {
        return NextResponse.json(
          { error: '«Avisar» aplica-se apenas a vendedores com o prazo expirado (overdue).' },
          { status: 400 }
        );
      }
      await sql`
        UPDATE users SET kyc_overdue_notified_at = NOW() WHERE id = ${userId}
      `;
      titulo = 'Lembrete: envia o teu documento de identidade';
      corpo =
        'A equipa AngoStart reenvia este lembrete: o prazo para verificar a tua identidade terminou e a publicação de novos produtos continua bloqueada. Envia a foto do teu documento no Painel de vendas para desbloqueares.';
      emailAssunto = `${titulo} — AngoStart`;
      emailCorpo = corpo;
    } else if (action === 'aceitar_justificacao') {
      /* Fase 13: anula a supervisão — volta a 'not_submitted' com nova
         janela de 30 dias (e pode voltar a publicar de imediato). */
      if (target[0].kyc_status !== 'overdue') {
        return NextResponse.json(
          { error: '«Aceitar justificação» aplica-se apenas a vendedores com o prazo expirado (overdue).' },
          { status: 400 }
        );
      }
      await sql`
        UPDATE users
        SET kyc_status = 'not_submitted',
            kyc_deadline = NOW() + ${`${KYC_GRACE_DAYS} days`}::interval,
            kyc_overdue_notified_at = NULL
        WHERE id = ${userId}
      `;
      titulo = 'Justificação aceite — prazo reaberto';
      corpo = `A tua justificação foi aceite pela equipa AngoStart: a supervisão foi anulada e já podes voltar a publicar produtos. Tens ${KYC_GRACE_DAYS} dias novos para enviar a foto do teu documento de identidade.`;
      emailAssunto = `${titulo} — AngoStart`;
      emailCorpo = corpo;
    } else {
      /* action === 'bloquear' — Fase 13: impede login e vendas
         (reversível no painel de utilizadores → gestão de contas). */
      await sql`
        UPDATE users SET blocked = TRUE WHERE id = ${userId}
      `;
      titulo = 'Conta bloqueada pela equipa AngoStart';
      corpo = note
        ? `A tua conta foi bloqueada pela equipa AngoStart. Motivo: ${note} Responde a este email para esclarecer a situação.`
        : 'A tua conta foi bloqueada pela equipa AngoStart por incumprimento das regras de verificação. Responde a este email para esclarecer a situação.';
      emailAssunto = `${titulo} — AngoStart`;
      emailCorpo = corpo;
    }

    /* Notificação in-app + email ao vendedor (melhor-esforço). */
    try {
      await sql`
        INSERT INTO notifications (user_id, title, body, link)
        VALUES (${userId}, ${titulo}, ${corpo}, ${'/dashboard/vendedor'})
      `;
      if (target[0].email) {
        await sendMail({
          to: target[0].email,
          subject: emailAssunto,
          html: `
            <div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">
              <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8f0">
                <h2 style="margin:0 0 8px;color:#0f172a">Ango<span style="color:#14b8a6">Start</span></h2>
                <p style="color:#0f172a">Olá ${target[0].name},</p>
                <p style="color:#0f172a">${emailCorpo}</p>
                <p><a href="${getAppUrl()}/dashboard/vendedor" style="color:#0d9488;font-weight:bold">Abrir o Painel de vendas →</a></p>
              </div>
            </div>`,
        }).catch(() => {});
      }
    } catch (notifyError) {
      console.error('[API admin/kyc] Notificação falhou (não crítico):', notifyError);
    }

    const estadoFinal: Record<Acao, string> = {
      aprovar: 'verified',
      rejeitar: 'rejected',
      avisar: 'overdue',
      aceitar_justificacao: 'not_submitted',
      bloquear: target[0].kyc_status,
    };

    return NextResponse.json({
      ok: true,
      action,
      user_id: userId,
      kyc_status: estadoFinal[action],
      is_verified_bi: action === 'aprovar',
      blocked: action === 'bloquear' ? true : undefined,
    });
  } catch (error) {
    console.error('[API admin/kyc] Erro no POST:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar a verificação agora.' },
      { status: 503 }
    );
  }
}
