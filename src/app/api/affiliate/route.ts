import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateByUserId,
  listAffiliateEarnings,
  getAffiliateEligibility,
  countAffiliateEarnings,
  AFFILIATE_TIER_THRESHOLD,
  AFFILIATE_TIER_PERCENT,
} from '@/lib/affiliate';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { isSellerRole } from '@/lib/auth';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/affiliate — dados de afiliado do utilizador autenticado
 * (código, percentual, comissões e total ganho). 404 se ainda não é
 * afiliado — usar POST /api/affiliate/register para aderir.
 * Fase 9: inclui link de referência, elegibilidade e progresso do escalão.
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
      /* Fase 9: mesmo sem adesão, devolve o estado de elegibilidade. */
      const elegibilidade = await getAffiliateEligibility(
        auth.user.id,
        isSellerRole(auth.user.role)
      );
      return NextResponse.json(
        { error: 'Ainda não és afiliado. Adere para ganhar comissões!', eligibility: elegibilidade },
        { status: 404 }
      );
    }

    const { earnings, total } = await listAffiliateEarnings(affiliate.id);
    const recebidas = await countAffiliateEarnings(affiliate.id);
    const elegibilidade = await getAffiliateEligibility(
      auth.user.id,
      isSellerRole(auth.user.role)
    );

    return NextResponse.json({
      codigo_afiliado: affiliate.codigo_afiliado,
      comissao_percentual: affiliate.comissao_percentual,
      created_at: affiliate.created_at,
      earnings,
      total_ganho: total,
      /* Fase 9 */
      referral_link: `${getAppUrl()}/?ref=${affiliate.codigo_afiliado}`,
      escalao: {
        comissoes_recebidas: recebidas,
        proximo_escalao_em: Math.max(0, AFFILIATE_TIER_THRESHOLD - recebidas),
        percentual_escalao_seguinte: AFFILIATE_TIER_PERCENT,
        no_escalao_maximo: affiliate.comissao_percentual >= AFFILIATE_TIER_PERCENT,
      },
      eligibility: elegibilidade,
    });
  } catch (error) {
    console.error('[API /api/affiliate] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar os dados de afiliado.' },
      { status: 503 }
    );
  }
}
