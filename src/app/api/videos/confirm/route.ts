import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { getUploadStatus, getAssetStatus, isMuxConfigured } from '@/lib/mux';
import { isUndefinedTableError, markVideosUnavailable } from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/videos/confirm — chamada pelo cliente APÓS o PUT direto do
 * ficheiro para o Mux.
 *
 * Corpo: { videoId }. Verifica junto do Mux se o Direct Upload já criou
 * o asset (status 'asset_created') e guarda o mux_asset_id; o estado
 * 'ready' + playback_id chega depois pelo webhook /api/mux/webhook.
 *
 * Devolve { status } — o cliente mostra "a processar…" e faz polling.
 */

export async function POST(request: NextRequest) {
  if (!isMuxConfigured()) {
    return NextResponse.json(
      { error: 'Integração de vídeo não configurada no servidor.' },
      { status: 503 }
    );
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'videos-confirm'), 30, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  let body: { videoId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
  if (!videoId || videoId.length > 64) {
    return NextResponse.json({ error: 'videoId inválido.' }, { status: 400 });
  }

  try {
    /* Apenas o dono pode confirmar o seu upload. */
    const rows = (await sql`
      SELECT id, mux_upload_id, status::text FROM videos
      WHERE id = ${videoId} AND user_id = ${user.id}
      LIMIT 1
    `) as unknown as { id: string; mux_upload_id: string | null; status: string }[];
    const video = rows[0];
    if (!video) {
      return NextResponse.json({ error: 'Vídeo não encontrado.' }, { status: 404 });
    }
    if (!video.mux_upload_id) {
      return NextResponse.json({ error: 'Upload não inicializado.' }, { status: 409 });
    }

    /* Pergunta ao Mux: o PUT do browser já criou o asset? */
    const upload = await getUploadStatus(video.mux_upload_id);
    console.info(
      `[API /api/videos/confirm] video=${videoId} status_bd=${video.status} ` +
        `mux_upload=${upload.status ?? '—'} assetId=${upload.assetId ?? '—'}`
    );

    if (upload.assetId) {
      const asset = await getAssetStatus(upload.assetId);
      const status = asset.status === 'ready' ? 'ready' : 'processing';
      await sql`
        UPDATE videos
        SET mux_asset_id = ${upload.assetId},
            status = ${status}::text,
            playback_id = COALESCE(${asset.playbackId}, playback_id),
            duration_seconds = ${asset.durationSeconds},
            error_message = ${asset.errorMessage},
            updated_at = now()
        WHERE id = ${videoId}
      `;
      console.info(
        `[API /api/videos/confirm] video=${videoId} → ${status} (asset=${upload.assetId})`
      );
      return NextResponse.json({ status });
    }

    /* Ainda 'waiting' — o PUT não terminou (ou falhou silenciosamente). */
    if (upload.status === 'errored' || upload.status === 'cancelled' || upload.status === 'timed_out') {
      console.error(
        `[API /api/videos/confirm] video=${videoId} → ERRORED (upload Mux: ${upload.status})`
      );
      await sql`
        UPDATE videos
        SET status = 'errored', error_message = ${`Upload no Mux: ${upload.status}`},
            updated_at = now()
        WHERE id = ${videoId}
      `;
      return NextResponse.json({ status: 'errored' });
    }

    console.info(
      `[API /api/videos/confirm] video=${videoId} ainda a aguardar PUT do browser (asset não criado)`
    );
    return NextResponse.json({ status: 'uploading' });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return NextResponse.json({ error: 'Funcionalidade de vídeo não ativada.' }, { status: 503 });
    }
    console.error('[API /api/videos/confirm] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível confirmar o upload agora.' },
      { status: 503 }
    );
  }
}
