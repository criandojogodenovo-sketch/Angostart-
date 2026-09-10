import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/roles';
import { clientKey, rateLimit } from '@/lib/security';
import { getCampaignStats } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Estatísticas de uma campanha (apenas dono/admin).
 *
 * GET /api/campanhas/[id]/estatisticas
 *   → códigos emitidos/utilizados, conversão %, por oportunidade e por
 *     canal de distribuição (sub_id — modelo do sistema de afiliados).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'campanha-stats'), 30, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const rows = (await sql`
    SELECT 1 FROM campaigns WHERE id = ${campaignId} AND owner_id = ${user.id} LIMIT 1
  `) as unknown as unknown[];
  const isOwner = rows.length > 0;
  if (!isOwner && !isAdminRole(user.role)) {
    return NextResponse.json({ error: 'Não tens permissão para ver estas estatísticas.' }, { status: 403 });
  }

  try {
    const stats = await getCampaignStats(campaignId);
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('[API /api/campanhas/[id]/estatisticas] Erro no GET:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as estatísticas.' }, { status: 503 });
  }
}
