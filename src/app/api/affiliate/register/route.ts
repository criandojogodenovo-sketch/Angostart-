import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAffiliate } from '@/lib/affiliate';
import { requireRole, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/affiliate/register — adere ao programa de afiliados.
 *
 * Cria (idempotente) um código único de referência (ex.: AFG-3K9PQX) para
 * o utilizador autenticado. Os clientes indicam o código no checkout e a
 * comissão (10%) é creditada automaticamente na carteira do afiliado
 * quando a encomenda é paga.
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
