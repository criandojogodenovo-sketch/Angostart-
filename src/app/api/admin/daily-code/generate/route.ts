import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAdmin } from '@/lib/security';
import { rotateDailyCode, logAdminAudit } from '@/lib/admin-invites';
import { sendDailyCodeEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

interface TargetAdmin {
  id: number;
  email: string;
}

/**
 * POST /api/admin/daily-code/generate — gera (ou roda) e envia o código
 * diário de 6 dígitos.
 *
 * Autorização (uma de):
 *  - Cookie/Bearer de ADMIN TOTAL com corpo { admin_id } ou { all: true }
 *    → usado pelo botão "Enviar código diário" / "Reenviar a todos".
 *  - Header `Authorization: Bearer $CRON_SECRET` → gera para todos
 *    (usado pelo cron diário das 00:00 em África/Luanda).
 *
 * O código é guardado apenas como hash; é enviado por email (Brevo).
 * Se o email falhar, devolve o código na resposta para entrega manual.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  let targets: TargetAdmin[] = [];
  let requestedBy = 'cron';
  let isCron = false;

  if (cronSecret && bearer && bearer === cronSecret) {
    isCron = true;
  } else {
    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    requestedBy = auth.user.email;
    if (!rateLimit(clientKey(request, 'daily-code-gen'), 10, 60_000)) {
      return NextResponse.json({ error: 'Aguarda um minuto.' }, { status: 429 });
    }

    let body: { admin_id?: number; all?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      /* corpo opcional para admin */
    }

    if (body.admin_id) {
      const rows = (await sql`
        SELECT id, email FROM users
        WHERE id = ${Number(body.admin_id)} AND role = 'admin_limitado' AND blocked = FALSE
        LIMIT 1
      `) as unknown as TargetAdmin[];
      targets = rows;
      if (targets.length === 0) {
        return NextResponse.json({ error: 'Admin limitado não encontrado.' }, { status: 404 });
      }
    } else {
      // Sem admin_id → todos os admin_limitado ativos
      targets = (await sql`
        SELECT id, email FROM users WHERE role = 'admin_limitado' AND blocked = FALSE
      `) as unknown as TargetAdmin[];
    }
  }

  if (isCron) {
    targets = (await sql`
      SELECT id, email FROM users WHERE role = 'admin_limitado' AND blocked = FALSE
    `) as unknown as TargetAdmin[];
  }

  try {
    const results: { email: string; delivered: boolean; code?: string }[] = [];
    for (const admin of targets) {
      const { code, expiresAt } = await rotateDailyCode(admin.id);
      const delivered = await sendDailyCodeEmail(admin.email, code, expiresAt);
      results.push({ email: admin.email, delivered, code: delivered ? undefined : code });

      await logAdminAudit({
        userId: admin.id,
        email: admin.email,
        event: 'daily_code_generated',
        detail: `por ${requestedBy}${delivered ? '' : ' · email falhou, entrega manual'}`,
      });
    }

    return NextResponse.json({
      ok: true,
      generated: results.length,
      results,
      message:
        results.length === 0
          ? 'Não há admins limitados ativos.'
          : `Código(s) diário(s) gerado(s) para ${results.length} conta(s).`,
    });
  } catch (error) {
    console.error('[API daily-code/generate] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível gerar o código diário.' }, { status: 503 });
  }
}
