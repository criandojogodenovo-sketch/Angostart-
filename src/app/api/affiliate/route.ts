import { NextRequest, NextResponse } from 'next/server';
import { getAffiliateByUserId, listAffiliateEarnings } from '@/lib/affiliate';
import { requireRole, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/affiliate — dados de afiliado do utilizador autenticado
 * (código, percentual, comissões e total ganho). 404 se ainda não é
 * afiliado — usar POST /api/affiliate/register para aderir.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'affiliate-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  try {
    const affiliate = await getAffiliateByUserId(auth.user.id);
    if (!affiliate) {
      return NextResponse.json(
        { error: 'Ainda não és afiliado. Adere para ganhar comissões!' },
        { status: 404 }
      );
    }

    const { earnings, total } = await listAffiliateEarnings(affiliate.id);

    return NextResponse.json({
      codigo_afiliado: affiliate.codigo_afiliado,
      comissao_percentual: affiliate.comissao_percentual,
      created_at: affiliate.created_at,
      earnings,
      total_ganho: total,
    });
  } catch (error) {
    console.error('[API /api/affiliate] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar os dados de afiliado.' },
      { status: 503 }
    );
  }
}
