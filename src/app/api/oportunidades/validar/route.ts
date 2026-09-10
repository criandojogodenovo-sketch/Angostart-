import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import { isAdminRole } from '@/lib/roles';
import { clientKey, rateLimit } from '@/lib/security';
import { redeemCode } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Validação de código de redemption na loja.
 *
 * POST /api/oportunidades/validar  — corpo { code: 'GMB-XXXXXX' }
 *
 * Regras de segurança:
 *  - Apenas vendedores (dono da campanha) ou admin validam — o mesmo modelo
 *    de posse de products/stores.
 *  - Anti-enumeração/brute-force: rate limit 10/min por IP + código não
 *    pertencente ao vendedor responde 404 genérico (não 403).
 *  - Atômico: UPDATE … WHERE status='emitido' AND expires_at > now() —
 *    dupla validação concorrente é impossível.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta para validar códigos.' }, { status: 401 });
  }
  if (!isSellerRole(user.role) && !isAdminRole(user.role)) {
    return NextResponse.json(
      { error: 'Apenas vendedores podem validar códigos de campanhas.' },
      { status: 403 }
    );
  }

  /* 10 tentativas/min por IP — endurece contra brute-force de códigos. */
  if (!rateLimit(clientKey(request, 'oportunidade-validar'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas. Aguarda um momento.' },
      { status: 429 }
    );
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  if (typeof body.code !== 'string') {
    return NextResponse.json({ error: 'Indica o código a validar (GMB-XXXXXX).' }, { status: 400 });
  }

  try {
    const result = await redeemCode({
      code: body.code,
      validatorUserId: user.id,
      isAdmin: isAdminRole(user.role),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      message: 'Código validado com sucesso! A vantagem foi aplicada ao consumidor.',
      opportunity_title: result.opportunity_title,
      campaign_title: result.campaign_title,
      used_at: result.used_at,
    });
  } catch (error) {
    console.error('[API /api/oportunidades/validar] Erro no POST:', error);
    return NextResponse.json({ error: 'Não foi possível validar o código agora.' }, { status: 503 });
  }
}
