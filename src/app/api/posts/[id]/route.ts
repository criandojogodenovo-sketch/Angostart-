import { NextRequest, NextResponse } from 'next/server';
import { deletePost, getPostById } from '@/lib/publicacoes-db';
import { requireRole } from '@/lib/security';
import { isAdminRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/posts/[id] — apagar Publicação.
 *
 * Autor: o dono da publicação. Admin total: qualquer uma (moderação).
 * Gostos e comentários caem automaticamente (ON DELETE CASCADE).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Publicação inválida.' }, { status: 400 });
  }

  const post = await getPostById(id);
  if (!post) {
    return NextResponse.json({ error: 'Publicação não encontrada.' }, { status: 404 });
  }

  if (post.user_id !== auth.user.id && !isAdminRole(auth.user.role)) {
    return NextResponse.json(
      { error: 'Só podes apagar as tuas próprias publicações.' },
      { status: 403 }
    );
  }

  try {
    await deletePost(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API /api/posts/[id]] DELETE falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível apagar. Tenta novamente.' },
      { status: 503 }
    );
  }
}
