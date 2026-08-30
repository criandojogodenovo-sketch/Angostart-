import { NextRequest, NextResponse } from 'next/server';
import { getAffiliateEligibility, getOrCreateAffiliate, getAffiliateByUserId } from '@/lib/affiliate';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { isSellerRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/affiliate/register — adere ao programa de afiliados.
 *
 * Fase 9 — regras de elegibilidade:
 *  - Vendedor/Prestador: ≥ 7 vendas concluídas (encomendas pagas).
 *  - Cliente: ≥ 2 compras concluídas (encomendas pagas).
 * Sem o requisito, devolve 403 com mensagem clara ("Necessitas de X…").
 * Cria (idempotente) um código único de referência (ex.: AFG-3K9PQX).
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (auth.user.role === 'admin' || auth.user.role === 'admin_limitado') {
    return NextResponse.json(
      { error: 'Contas de administração não participam no programa de afiliados.' },
      { status: 403 }
    );
  }

  if (!rateLimit(clientKey(request, 'affiliate-register'), 5, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  try {
    /* Quem já é afiliado mantém o código (regra aplica-se só à adesão). */
    const existing = await getAffiliateByUserId(auth.user.id);
    if (!existing) {
      const elegibilidade = await getAffiliateEligibility(
        auth.user.id,
        isSellerRole(auth.user.role)
      );
      if (!elegibilidade.eligible) {
        return NextResponse.json(
          { error: elegibilidade.message, code: 'AFFILIATE_NOT_ELIGIBLE', eligibility: elegibilidade },
          { status: 403 }
        );
      }
    }

    const affiliate = await getOrCreateAffiliate(auth.user.id);

    return NextResponse.json(
      {
        ok: true,
        codigo_afiliado: affiliate.codigo_afiliado,
        comissao_percentual: affiliate.comissao_percentual,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API affiliate/register] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível criar o teu código de afiliado agora.' },
      { status: 503 }
    );
  }
}
