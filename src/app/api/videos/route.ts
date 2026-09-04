import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';
import {
  isUndefinedTableError,
  markVideosUnavailable,
  maybeAutoVerifyStaleVideos,
  sweepTimedOutUploads,
  verifyPendingAtMux,
  type VerifiedTransition,
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
 *    com polling no cliente. Aplica o timeout automático de 15 min:
 *    uploads 'uploading' antigos passam a 'errored' (com notificação).
 *  - ?meu=1&include=stale: além do timeout, VERIFICA no Mux os vídeos
 *    pendentes do utilizador (self-healing quando o webhook não chega)
 *    e atualiza o estado real antes de devolver a lista.
 *
 * Degradação graciosa: tabela ainda não migrada → { videos: [] }.
 */

/** Notifica falhas (sino + web push) — melhor-esforço, nunca quebra. */
async function notifyFailures(
  transitions: { userId: number; title: string; to: string }[]
): Promise<void> {
  for (const t of transitions) {
    if (t.to !== 'errored') continue;
    try {
      await pushNotification(
        t.userId,
        'O teu vídeo não foi publicado',
        `«${t.title || 'Sem título'}» não foi concluído a tempo. Tenta publicar novamente.`,
        '/busbt'
      );
    } catch {
      /* notificação é opcional */
    }
  }
}

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
      const includeStale = searchParams.get('include') === 'stale';

      /* 0. AUTO-VERIFICAÇÃO 60 s (correcção do «A finalizar envio…»):
            qualquer pedido autenticado à lista dispara uma varredura
            GLOBAL de vídeos presos (> 5 min) direto no Mux — no máximo
            1× por minuto por instância, melhor-esforço. Custo ~50 ms
            quando não há vídeos presos (SELECT vazio); até ~2 s no pior
            caso (≤ 5 vídeos presos), o cenário exato que estamos a
            corrigir. Nunca quebra a resposta. */
      await maybeAutoVerifyStaleVideos();

      /* 1. Self-healing PRIMEIRO: verifica pendentes no Mux (webhook
            perdido?) e aplica o estado REAL — assim um vídeo que o Mux
            JÁ tem pronto nunca é sacrificado pelo timeout do passo 2. */
      const transitions: VerifiedTransition[] = includeStale
        ? await verifyPendingAtMux(user.id)
        : [];

      /* 2. Timeout automático: o que CONTINUA 'uploading' (o Mux não
            tem o ficheiro) > 15 min → 'errored'. */
      const swept = await sweepTimedOutUploads(user.id, 15);

      /* 3. Notifica falhas detetadas (sino + web push). */
      const failures: { userId: number; title: string; to: string }[] = [
        ...swept.map((s) => ({
          userId: s.user_id,
          title: s.title,
          to: 'errored',
        })),
        ...transitions.map((t) => ({
          userId: t.userId,
          title: t.title,
          to: t.to as string,
        })),
      ];
      await notifyFailures(failures);

      const rows = (await sql`
        SELECT v.id, v.user_id, v.title, v.description, v.status::text,
               v.playback_id, v.duration_seconds::float8, v.error_message,
               v.created_at
        FROM videos v
        WHERE v.user_id = ${user.id}
        ORDER BY v.created_at DESC
      `) as unknown as VideoRow[];
      return NextResponse.json({
        videos: rows,
        source: 'neon',
        swept: swept.length,
        refreshed: transitions.length,
      });
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
