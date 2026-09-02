import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAdmin } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';
import {
  isUndefinedTableError,
  verifyPendingAtMux,
  type VideoStatus,
} from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/videos/[id] — forçar estado / reverificar no Mux.
 * 🔒 apenas admin (requireAdmin).
 *
 * Corpos aceites:
 *  - { refresh: true }                 → pergunta ao Mux o estado real do
 *    vídeo e atualiza a linha (self-healing manual).
 *  - { status: 'uploading'|'processing'|'ready'|'errored' } → força o
 *    estado. 'ready' exige que a linha já tenha (ou o corpo envie)
 *    playback_id — sem ele o player não funciona.
 *
 * Marcar 'errored' notifica o dono (sino + web push), igual às falhas
 * automáticas.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-videos-patch'), 30, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const videoId = typeof id === 'string' ? id.trim() : '';
  if (!videoId || videoId.length > 64) {
    return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
  }

  let body: { status?: unknown; refresh?: unknown; playbackId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, user_id, title, status::text AS status, playback_id, mux_upload_id
      FROM videos WHERE id = ${videoId} LIMIT 1
    `) as unknown as {
      id: string;
      user_id: number;
      title: string;
      status: VideoStatus;
      playback_id: string | null;
      mux_upload_id: string | null;
    }[];
    const video = rows[0];
    if (!video) {
      return NextResponse.json({ error: 'Vídeo não encontrado.' }, { status: 404 });
    }

    /* ── Modo 1: reverificar no Mux (self-healing manual) ── */
    if (body.refresh === true) {
      if (video.status !== 'uploading' && video.status !== 'processing') {
        return NextResponse.json({
          status: video.status,
          message: 'O vídeo já está num estado final — nada a verificar.',
        });
      }
      const transitions = await verifyPendingAtMux(video.user_id, {
        videoId,
        graceMinutes: 0,
        max: 1,
      });
      const to = transitions[0]?.to ?? video.status;
      if (transitions[0]?.to === 'errored') {
        await notifyOwner(video.user_id, video.title);
      }
      return NextResponse.json({ status: to, refreshed: transitions.length > 0 });
    }

    /* ── Modo 2: forçar estado ── */
    const status = typeof body.status === 'string' ? body.status : '';
    const VALID: VideoStatus[] = ['uploading', 'processing', 'ready', 'errored'];
    if (!VALID.includes(status as VideoStatus)) {
      return NextResponse.json(
        { error: `Estado inválido — usa: ${VALID.join(', ')}.` },
        { status: 400 }
      );
    }

    if (status === 'ready') {
      const playbackId =
        typeof body.playbackId === 'string' && body.playbackId.trim()
          ? body.playbackId.trim()
          : video.playback_id;
      if (!playbackId) {
        return NextResponse.json(
          { error: "'ready' exige um playback_id — usa { refresh: true } para o obter do Mux." },
          { status: 400 }
        );
      }
      await sql`
        UPDATE videos
        SET status = 'ready',
            playback_id = ${playbackId},
            error_message = NULL,
            updated_at = now()
        WHERE id = ${videoId}
      `;
      return NextResponse.json({ status: 'ready' });
    }

    await sql`
      UPDATE videos
      SET status = ${status}::text,
          error_message = ${status === 'errored' ? 'Marcado como falhado por um administrador.' : null},
          updated_at = now()
      WHERE id = ${videoId}
    `;
    if (status === 'errored') {
      await notifyOwner(video.user_id, video.title);
    }
    return NextResponse.json({ status });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return NextResponse.json(
        { error: 'Funcionalidade de vídeo não ativada.' },
        { status: 503 }
      );
    }
    console.error('[API admin/videos PATCH] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar o vídeo.' }, { status: 500 });
  }
}

/** Sino + web push ao dono — melhor-esforço, nunca quebra a resposta. */
async function notifyOwner(userId: number, title: string): Promise<void> {
  try {
    await pushNotification(
      userId,
      'O teu vídeo não foi publicado',
      `«${title || 'Sem título'}» foi marcado como falhado pela equipa AngoStart.`,
      '/busbt'
    );
  } catch {
    /* opcional */
  }
}
