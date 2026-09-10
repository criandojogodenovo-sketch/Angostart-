import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { getAffiliateByUserId } from '@/lib/affiliate';
import { listMyDistributions } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Resultados de DISTRIBUIÇÃO do afiliado autenticado.
 *
 * GET /api/campanhas/distribuicoes
 *   → códigos emitidos/utilizados por oportunidade que o afiliado
 *     partilhou (links ?ref=AFG-XXXXXX — capturados no claim).
 *
 * Reutiliza o sistema de afiliados existente (Fase 4/9/10): o
 * distribuidor é o afiliado; os resultados vêm de ref_affiliate_id.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, 'campanhas-distribuicoes'), 30, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const affiliate = await getAffiliateByUserId(user.id);
    if (!affiliate) {
      /* Sem registo de afiliado → ainda não distribuiu nada (não cria). */
      return NextResponse.json({ distributions: [], has_affiliate: false });
    }
    const distributions = await listMyDistributions(affiliate.id);
    return NextResponse.json({ distributions, has_affiliate: true, affiliate_code: affiliate.codigo_afiliado });
  } catch (error) {
    console.error('[API /api/campanhas/distribuicoes] Erro no GET:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as tuas distribuições.' }, { status: 503 });
  }
}
