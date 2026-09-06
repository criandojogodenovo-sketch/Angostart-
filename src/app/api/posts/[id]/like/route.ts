import { NextRequest, NextResponse } from 'next/server';
import { toggleLike } from '@/lib/publicacoes-db';
import { requireRole, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/[id]/like — dar/remover «gostar» (toggle).
 *
 * Autenticado (qualquer conta). Idempotente: repetir o pedido inverte.
 * Resposta: { liked: boolean, likes: number } (novo total).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 60 gostos/min — evita spam de botão em rede lenta
  if (!rateLimit(clientKey(request, 'post-like'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Calma nos gostos — aguarda um momento.' },
      { status: 429 }
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Publicação inválida.' }, { status: 400 });
  }

  try {
    const result = await toggleLike(id, auth.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API /api/posts/[id]/like] falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar o teu gosto. Tenta novamente.' },
      { status: 503 }
    );
  }
}
