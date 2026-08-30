import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin, clientKey, rateLimit } from '@/lib/security';
import { sendMail } from '@/lib/email';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/kyc (Fase 9) — fila de verificação de identidade.
 * Lista vendedores/prestadores com BI submetido, separados por estado:
 * pendentes (is_verified_bi = FALSE com bi_number), verificados e sem BI.
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
    const rows = (await sql`
      SELECT id, name, email, role, username, telefone,
             bi_number, nif_number, kyc_status,
             is_verified_bi::boolean,
             bi_document_url,
             bi_verified_at, created_at
      FROM users
      WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
        AND bi_number IS NOT NULL
      ORDER BY is_verified_bi ASC, created_at DESC
      LIMIT 200
    `) as unknown as {
      id: number;
      name: string;
      email: string;
      role: string;
      username: string | null;
      telefone: string | null;
      bi_number: string;
      nif_number: string | null;
      kyc_status: string;
      is_verified_bi: boolean;
      bi_document_url: string | null;
      bi_verified_at: string | null;
      created_at: string;
    }[];

    const semBi = (await sql`
      SELECT COUNT(*)::int AS n
      FROM users
      WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
        AND bi_number IS NULL
    `) as unknown as { n: number }[];

    return NextResponse.json({
      pending: rows.filter((r) => !r.is_verified_bi),
      verified: rows.filter((r) => r.is_verified_bi),
      sellers_without_bi: semBi[0]?.n ?? 0,
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
 * POST /api/admin/kyc (Fase 9) — aprovar/rejeitar o BI de um vendedor.
 * Corpo: { user_id, action: 'aprovar' | 'rejeitar', note? }
 *  - aprovar  → is_verified_bi = TRUE, kyc_status = 'verified'
 *  - rejeitar → is_verified_bi = FALSE, kyc_status = 'rejected',
 *               bi_number/bi_document_url limpos (reenvio obrigatório)
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
  const action = body.action === 'aprovar' ? 'aprovar' : body.action === 'rejeitar' ? 'rejeitar' : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (!Number.isInteger(userId) || userId <= 0 || !action) {
    return NextResponse.json(
      { error: 'Indica user_id e action («aprovar» ou «rejeitar»).' },
      { status: 400 }
    );
  }

  try {
    const target = (await sql`
      SELECT id, name, email, role, bi_number FROM users
      WHERE id = ${userId} AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
      LIMIT 1
    `) as unknown as { id: number; name: string; email: string; role: string; bi_number: string | null }[];

    if (!target[0]) {
      return NextResponse.json({ error: 'Vendedor não encontrado.' }, { status: 404 });
    }

    if (action === 'aprovar') {
      await sql`
        UPDATE users
        SET is_verified_bi = TRUE, kyc_status = 'verified',
            bi_verified_at = NOW(), bi_verified_by = ${auth.user.id}
        WHERE id = ${userId}
      `;
    } else {
      await sql`
        UPDATE users
        SET is_verified_bi = FALSE, kyc_status = 'rejected',
            bi_number = NULL, bi_document_url = NULL,
            bi_verified_at = NULL, bi_verified_by = ${auth.user.id}
        WHERE id = ${userId}
      `;
    }

    /* Notificação in-app + email ao vendedor (melhor-esforço). */
    const titulo =
      action === 'aprovar' ? 'Identidade verificada ✓' : 'Verificação de identidade recusada';
    const corpo =
      action === 'aprovar'
        ? 'O teu BI foi aprovado — já tens o selo azul de vendedor verificado e podes publicar novos produtos.'
        : `O teu BI não foi validado.${note ? ` Nota da equipa: ${note}` : ''} Submete novamente o documento no teu perfil para voltar a publicar.`;
    try {
      await sql`
        INSERT INTO notifications (user_id, title, body, link)
        VALUES (${userId}, ${titulo}, ${corpo}, ${'/perfil'})
      `;
      if (target[0].email) {
        await sendMail({
          to: target[0].email,
          subject: `${titulo} — AngoStart`,
          html: `
            <div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">
              <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8f0">
                <h2 style="margin:0 0 8px;color:#0f172a">Ango<span style="color:#10b981">Start</span></h2>
                <p style="color:#0f172a">Olá ${target[0].name},</p>
                <p style="color:#0f172a">${corpo}</p>
                <p><a href="${getAppUrl()}/perfil" style="color:#059669;font-weight:bold">Abrir o meu perfil →</a></p>
              </div>
            </div>`,
        }).catch(() => {});
      }
    } catch (notifyError) {
      console.error('[API admin/kyc] Notificação falhou (não crítico):', notifyError);
    }

    return NextResponse.json({
      ok: true,
      action,
      user_id: userId,
      is_verified_bi: action === 'aprovar',
    });
  } catch (error) {
    console.error('[API admin/kyc] Erro no POST:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar a verificação agora.' },
      { status: 503 }
    );
  }
}
