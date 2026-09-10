import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { sanitizeSubId } from '@/lib/affiliate';
import {
  anonCookieOptions,
  claimOpportunity,
  getOrCreateAnonId,
} from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/**
 * GOMBUONE — Resgate (claim) do código de uma oportunidade.
 *
 * POST /api/oportunidades/[id]/resgatar   — PÚBLICO (visitante ou conta).
 *
 * Regras de segurança (herdadas + reforçadas):
 *  - Identidade do consumidor: cookie httpOnly `gombuone_anon` (UUID v4,
 *    CSPRNG). NUNCA IP, NUNCA WhatsApp/nome (não deduplicam identidade).
 *  - Idempotente: re-claim devolve o MESMO código ativo (índice único
 *    parcial em (opportunity_id, anon_id) WHERE status='emitido').
 *  - Atribuição de distribuição: `affiliate_code`+`affiliate_sub_id`
 *    opcionais, vindos do RefCapture existente (?ref=AFG-…&sub=canal).
 *  - Rate limit por IP (anti-abuso de emissão).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const opportunityId = Number(id);
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'Oportunidade inválida.' }, { status: 400 });
  }

  /* 5 pedidos/min por IP — protege a emissão contra abuso. */
  if (!rateLimit(clientKey(request, 'oportunidade-claim'), 5, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento antes de pedir outro código.' },
      { status: 429 }
    );
  }

  /* Corpo opcional: atribuição do link partilhado (RefCapture). */
  let body: { affiliate_code?: unknown; affiliate_sub_id?: unknown } = {};
  try {
    body = (await request.json()) as { affiliate_code?: unknown; affiliate_sub_id?: unknown };
  } catch {
    /* corpo vazio é válido — claim sem atribuição */
  }

  const affiliateCode =
    typeof body.affiliate_code === 'string'
      ? body.affiliate_code.trim().toUpperCase().slice(0, 20)
      : null;
  if (affiliateCode && !/^[A-Z0-9-]{4,20}$/.test(affiliateCode)) {
    return NextResponse.json(
      { error: 'Código de afiliado inválido — usa o formato AFG-XXXXXX.' },
      { status: 400 }
    );
  }
  const affiliateSubId = sanitizeSubId(body.affiliate_sub_id);

  /* Identidade anónima: cookie httpOnly (nunca IP). */
  const { anonId, isNew } = getOrCreateAnonId(request);
  const user = await getAuthUser(request);

  try {
    const result = await claimOpportunity({
      opportunityId,
      anonId,
      userId: user?.id ?? null,
      affiliateCode,
      subId: affiliateSubId,
    });

    if (!result.ok) {
      const response = NextResponse.json({ error: result.error }, { status: result.status });
      if (isNew) response.cookies.set('gombuone_anon', anonId, anonCookieOptions());
      return response;
    }

    const response = NextResponse.json(
      {
        ok: true,
        code: result.code,
        expires_at: result.expires_at,
        reused: result.reused,
        message: result.reused
          ? 'Este é o teu código ativo desta oportunidade (já o tinhas recebido).'
          : 'Código emitido! Apresenta-o na loja para validar a tua vantagem.',
      },
      { status: result.reused ? 200 : 201 }
    );
    if (isNew) response.cookies.set('gombuone_anon', anonId, anonCookieOptions());
    return response;
  } catch (error) {
    console.error('[API /api/oportunidades/[id]/resgatar] Erro no POST:', error);
    return NextResponse.json(
      { error: 'Não foi possível emitir o código agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
