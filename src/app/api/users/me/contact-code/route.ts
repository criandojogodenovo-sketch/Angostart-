import { NextRequest, NextResponse } from 'next/server';
import { ensureContactCode } from '@/lib/publicacoes-db';
import { requireSeller } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me/contact-code — o código de contacto do vendedor.
 *
 * Devolve o código existente ou gera um novo (CONTATO-XXXXXX) na
 * primeira chamada. O vendedor usa este código nos posts e fora da
 * plataforma (WhatsApp/Instagram): quem o recebe abre
 * /contato/CODIGO e chega ao perfil público.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { code } = await ensureContactCode(auth.user.id);
    return NextResponse.json(
      { contact_code: code },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API /api/users/me/contact-code] falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível obter o teu código. Tenta novamente.' },
      { status: 503 }
    );
  }
}
