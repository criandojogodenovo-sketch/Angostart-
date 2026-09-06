import { NextRequest, NextResponse } from 'next/server';
import { ensurePublicacoesTables, resolveContactCode } from '@/lib/publicacoes-db';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ code: string }> };

/**
 * GET /api/contact/[code] — resolver um código de contacto (público).
 *
 * O código CONTATO-XXXXXX aparece nos posts e pode ser partilhado fora
 * da plataforma. Resolve para { username, name } — o cliente redireciona
 * para /portfolio/[username]. Sem expor telefone/email.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'contact-resolve'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const { code: rawCode } = await context.params;
  const code = decodeURIComponent(rawCode).trim().toUpperCase();

  if (!/^CONTATO-[A-Z0-9-]{1,20}$/.test(code)) {
    return NextResponse.json({ error: 'Código inválido.' }, { status: 400 });
  }

  await ensurePublicacoesTables();

  try {
    const seller = await resolveContactCode(code);
    if (!seller || !seller.username) {
      return NextResponse.json(
        { error: 'Código não encontrado. Confirma com o vendedor.' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { username: seller.username, name: seller.name },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (error) {
    console.error('[API /api/contact/[code]] falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível resolver o código. Tenta novamente.' },
      { status: 503 }
    );
  }
}
