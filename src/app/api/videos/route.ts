import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import {
  isUndefinedTableError,
  markVideosUnavailable,
  VIDEO_AUTHOR_COLUMNS,
  type VideoRow,
} from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/videos — lista de vídeos da aba Busbt.
 *
 *  - Sem parâmetros (PÚBLICO): apenas vídeos 'ready', mais recentes
 *    primeiro, com metadados do autor (nome, username, selo BI).
 *  - ?meu=1 (autenticado): TODOS os vídeos do utilizador (uploading /
 *    processing / ready / errored) — alimenta o estado "a processar"
 *    com polling no cliente.
 *
 * Degradação graciosa: tabela ainda não migrada → { videos: [] }.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'videos-get'), 120, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get('meu') === '1';

  try {
    if (mine) {
      const user = await getAuthUser(request);
      if (!user) {
        return NextResponse.json(
          { error: 'Sessão inválida ou expirada. Entra novamente.' },
          { status: 401 }
        );
      }
      const rows = (await sql`
        SELECT v.id, v.user_id, v.title, v.description, v.status::text,
               v.playback_id, v.duration_seconds::float8, v.error_message,
               v.created_at
        FROM videos v
        WHERE v.user_id = ${user.id}
        ORDER BY v.created_at DESC
      `) as unknown as VideoRow[];
      return NextResponse.json({ videos: rows, source: 'neon' });
    }

    const rows = (await sql`
      SELECT v.id, v.title, v.description, v.status::text,
             v.playback_id, v.duration_seconds::float8,
             v.created_at, v.user_id,
             ${VIDEO_AUTHOR_COLUMNS}
      FROM videos v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.status = 'ready' AND v.playback_id IS NOT NULL
      ORDER BY v.created_at DESC
      LIMIT 60
    `) as unknown as (VideoRow & {
      author_name: string | null;
      author_username: string | null;
      author_role: string | null;
      author_verified: boolean | null;
    })[];
    return NextResponse.json({ videos: rows, source: 'neon' });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return NextResponse.json({ videos: [], source: 'fallback' });
    }
    console.error('[API /api/videos] Erro:', error);
    return NextResponse.json({ videos: [], source: 'fallback' });
  }
}
