import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { rotateDailyCode, logAdminAudit } from '@/lib/admin-invites';
import { sendDailyCodeEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/daily-codes — tarefa agendada (Vercel Cron, 00:00 em
 * África/Luanda = 23:00 UTC): gera e envia o código diário de 6 dígitos
 * para todos os admins limitados ativos.
 *
 * 🔒 Proteção: header `Authorization: Bearer $CRON_SECRET` (a Vercel envia
 * automaticamente quando CRON_SECRET está definida). Sem CRON_SECRET,
 * só é permitido em desenvolvimento.
 */
export async function GET(request: NextRequest) {
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

  try {
    const admins = (await sql`
      SELECT id, email FROM users WHERE role = 'admin_limitado' AND blocked = FALSE
    `) as unknown as { id: number; email: string }[];

    let sent = 0;
    for (const admin of admins) {
      const { code, expiresAt } = await rotateDailyCode(admin.id);
      const delivered = await sendDailyCodeEmail(admin.email, code, expiresAt);
      if (delivered) sent += 1;
      await logAdminAudit({
        userId: admin.id,
        email: admin.email,
        event: 'daily_code_generated',
        detail: `cron · ${delivered ? 'email enviado' : 'email falhou'}`,
      });
    }

    return NextResponse.json({
      ok: true,
      admins: admins.length,
      emailsSent: sent,
      date: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron/daily-codes] Erro:', error);
    return NextResponse.json({ error: 'Falha na geração dos códigos diários.' }, { status: 503 });
  }
}
