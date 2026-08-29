import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sanitizeText, clientKey, rateLimit, requireAdmin } from '@/lib/security';
import { listSuspiciousActivities } from '@/lib/antifraud';

export const dynamic = 'force-dynamic';

/**
 * Painel de MONITORIZAÇÃO anti-burla (Fase 5) — 🔒 apenas admin total.
 *
 * GET  ?status=aberta|ignorada|resolvida (default: aberta) — lista atividades.
 * POST { id, acao: 'desbloquear'|'banir'|'ignorar'|'resolver' } — decide.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'monitorizacao'), 60, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  try {
    const activities = await listSuspiciousActivities(status);
    const counts = (await sql`
      SELECT status, count(*)::int AS n
      FROM suspicious_activities
      GROUP BY status
    `) as unknown as { status: string; n: number }[];

    return NextResponse.json({
      activities,
      counts: counts.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = Number(r.n);
        return acc;
      }, {}),
    });
  } catch (error) {
    console.error('[API admin/monitorizacao GET] Erro:', error);
    return NextResponse.json({ activities: [], counts: {} });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'monitorizacao-post'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { id?: unknown; acao?: unknown; nota?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const id = Number(body.id);
  const acao = sanitizeText(body.acao, 20);
  const nota = sanitizeText(body.nota, 200) || null;

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Atividade inválida.' }, { status: 400 });
  }
  if (!['desbloquear', 'banir', 'ignorar', 'resolver'].includes(acao)) {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  try {
    const activities = (await sql`
      SELECT id, user_id, action FROM suspicious_activities WHERE id = ${id} LIMIT 1
    `) as unknown as { id: number; user_id: number; action: string }[];
    const activity = activities[0];
    if (!activity) {
      return NextResponse.json({ error: 'Atividade não encontrada.' }, { status: 404 });
    }

    switch (acao) {
      case 'desbloquear':
        await sql`UPDATE users SET blocked = FALSE WHERE id = ${activity.user_id}`;
        await sql`
          UPDATE suspicious_activities SET status = 'resolvida', processed_by = ${auth.user.id}, processed_at = now()
          WHERE id = ${id}
        `;
        break;
      case 'banir':
        // Banimento permanente: bloqueia e fecha as atividades como resolvidas
        await sql`UPDATE users SET blocked = TRUE WHERE id = ${activity.user_id}`;
        await sql`
          UPDATE suspicious_activities
          SET status = 'resolvida', details = COALESCE(details, '') || ${' | Banimento aplicado' + (nota ? `: ${nota}` : '')},
              processed_by = ${auth.user.id}, processed_at = now()
          WHERE user_id = ${activity.user_id} AND status = 'aberta'
        `;
        break;
      case 'ignorar':
        await sql`
          UPDATE suspicious_activities SET status = 'ignorada', processed_by = ${auth.user.id}, processed_at = now()
          WHERE id = ${id}
        `;
        break;
      case 'resolver':
        await sql`
          UPDATE suspicious_activities SET status = 'resolvida', processed_by = ${auth.user.id}, processed_at = now()
          WHERE id = ${id}
        `;
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API admin/monitorizacao POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível aplicar a ação.' }, { status: 503 });
  }
}
