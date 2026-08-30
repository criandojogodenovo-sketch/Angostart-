import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { toggleStoreFollow } from '@/lib/stores';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/follow — segue/deixa de seguir uma loja (Fase 9).
 * Corpo: { store_id }
 * Devolve { following: boolean }. Seguidores recebem notificação de
 * novos produtos da loja.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para seguir lojas.' },
      { status: 401 }
    );
  }

  if (!rateLimit(clientKey(request, 'stores-follow'), 30, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  let body: { store_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const storeId = Number(body.store_id);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: 'Loja inválida.' }, { status: 400 });
  }

  try {
    const store = (await sql`
      SELECT id, owner_id FROM stores WHERE id = ${storeId} LIMIT 1
    `) as unknown as { id: number; owner_id: number }[];
    if (!store[0]) {
      return NextResponse.json({ error: 'Loja não encontrada.' }, { status: 404 });
    }
    if (store[0].owner_id === user.id) {
      return NextResponse.json(
        { error: 'Não podes seguir a tua própria loja — ela já é tua!' },
        { status: 400 }
      );
    }

    const following = await toggleStoreFollow(storeId, user.id);
    return NextResponse.json({ ok: true, following });
  } catch (error) {
    console.error('[API /api/stores/follow] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar agora. Tenta em instantes.' },
      { status: 503 }
    );
  }
}
