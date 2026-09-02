import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser, isAdminRole } from '@/lib/auth';
import { rateLimit, clientKey } from '@/lib/security';
import { deleteAsset } from '@/lib/mux';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/videos/[id] — remove um vídeo da aba Busbt.
 *
 * Autenticada. Apenas o DONO do vídeo ou um admin pode eliminar.
 *  1. Elimina o asset no Mux (as rendições/CDN desaparecem).
 *  2. Remove a linha na base de dados.
 * O Mux falhar (asset já apagado) não bloqueia a limpeza local.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'videos-delete'), 20, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { id } = await params;
  const videoId = typeof id === 'string' ? id.trim() : '';
  if (!videoId || videoId.length > 64) {
    return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, mux_asset_id FROM videos WHERE id = ${videoId} LIMIT 1
    `) as unknown as { id: string; user_id: number; mux_asset_id: string | null }[];
    const video = rows[0];
    if (!video) {
      return NextResponse.json({ error: 'Vídeo não encontrado.' }, { status: 404 });
    }
    if (video.user_id !== user.id && !isAdminRole(user.role)) {
      return NextResponse.json(
        { error: 'Não tens permissão para eliminar este vídeo.' },
        { status: 403 }
      );
    }

    /* 1. Asset no Mux (best-effort — 404 do Mux é irrelevante). */
    if (video.mux_asset_id) {
      try {
        await deleteAsset(video.mux_asset_id);
      } catch (muxError) {
        console.warn('[API /api/videos/:id] Asset já removido no Mux:', muxError);
      }
    }

    /* 2. Linha local. */
    await sql`DELETE FROM videos WHERE id = ${videoId}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API /api/videos/:id] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível eliminar o vídeo agora.' },
      { status: 503 }
    );
  }
}
