import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  clientKey,
  rateLimit,
  isSafeHttpUrl,
  sanitizeText,
  sanitizeMultiline,
} from '@/lib/security';
import {
  MAX_VIDEO_BYTES,
  isAllowedVideoType,
  isMuxConfigured,
  createDirectUpload,
} from '@/lib/mux';
import { isUndefinedTableError, markVideosUnavailable } from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/upload/video — inicia a publicação de um vídeo na aba Busbt.
 *
 * Autenticada (Bearer JWT). Corpo: { filename, contentType, size }.
 * Fluxo Mux Direct Upload:
 *   1. Esta rota cria a linha `videos` (status='uploading') e um Direct
 *      Upload no Mux → devolve { uploadUrl, uploadId, videoId }.
 *   2. O browser faz PUT do ficheiro DIRETAMENTE para o Mux (o vídeo
 *      nunca passa pelo servidor da Vercel).
 *   3. POST /api/videos/confirm deteta o asset criado.
 *   4. O webhook /api/mux/webhook marca 'ready' com o playback_id.
 *
 * Segurança:
 *  - tipos válidos: video/mp4, video/webm, video/quicktime;
 *  - tamanho máx. 100 MB (informado pelo cliente e verificado no Mux);
 *  - rate limit: 5 uploads/hora por IP e por utilizador;
 *  - MUX_TOKEN_* nunca sai do servidor.
 */

interface Body {
  filename?: unknown;
  contentType?: unknown;
  size?: unknown;
  /** Título amigável (opcional — default: nome do ficheiro). */
  title?: unknown;
  /** Descrição opcional (promove o produto/serviço no vídeo). */
  description?: unknown;
}

/**
 * Origin autorizada para o CORS do PUT (browser → Mux).
 *
 * ⚠️ Causa raiz do "Erro de rede": quando o header `Origin` não chega
 * (alguns WebViews móveis omitem-no em pedidos same-origin), o fallback
 * antigo usava NEXT_PUBLIC_APP_URL/VERCEL_URL — se esse domínio não for
 * EXATAMENTE a origem da página, o Mux devolve `Access-Control-Allow-Origin`
 * errado e o browser bloqueia a RESPOSTA do PUT (o ficheiro até chega ao
 * Mux — webhook dispara — mas o cliente vê `onerror` como "erro de rede").
 *
 * Correção: com Origin presente → match exato; sem Origin → `*`
 * (o Mux aceita wildcard; o URL de upload já é o segredo de acesso,
 * o CORS não adiciona proteção aqui).
 */
function resolveCorsOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  if (origin && isSafeHttpUrl(origin)) return origin;
  return '*';
}

export async function POST(request: NextRequest) {
  if (!isMuxConfigured()) {
    return NextResponse.json(
      {
        error:
          'A publicação de vídeos ainda não está ativa (Mux não configurado). Define MUX_TOKEN_ID e MUX_TOKEN_SECRET na Vercel.',
      },
      { status: 503 }
    );
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Precisas de entrar para publicar um vídeo. Sessão inválida ou expirada.' },
      { status: 401 }
    );
  }

  /* Anti-abuso: 5 uploads/hora por utilizador E por IP. */
  if (
    !rateLimit(`video-upload-user:${user.id}`, 5, 3_600_000) ||
    !rateLimit(clientKey(request, 'video-upload-ip'), 8, 3_600_000)
  ) {
    return NextResponse.json(
      { error: 'Atingiste o limite de 5 vídeos por hora. Tenta mais tarde.' },
      { status: 429 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const filename =
    typeof body.filename === 'string' ? body.filename.trim().slice(0, 120) : '';
  const contentType =
    typeof body.contentType === 'string' ? body.contentType.trim() : '';
  const size = Number(body.size);
  const title = sanitizeText(body.title, 80);
  const description = sanitizeMultiline(body.description, 500);

  if (!isAllowedVideoType(contentType)) {
    return NextResponse.json(
      { error: 'Formato não suportado — envia MP4, WebM ou MOV (video/quicktime).' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json(
      { error: 'Tamanho do ficheiro inválido.' },
      { status: 400 }
    );
  }
  if (size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: 'O vídeo deve ter no máximo 100 MB.' },
      { status: 413 }
    );
  }

  try {
    /* 1. Linha interna (passthrough = videos.id identifica o webhook). */
    const inserted = (await sql`
      INSERT INTO videos (user_id, title, description, status)
      VALUES (${user.id}, ${title || filename || 'Vídeo sem título'}, ${description || null}, 'uploading')
      RETURNING id
    `) as unknown as { id: string }[];
    const videoId = inserted[0].id;

    /* 2. Direct Upload no Mux (URL assinado, CORS para o browser). */
    const corsOrigin = resolveCorsOrigin(request);
    console.log(
      `[API /api/upload/video] user=${user.id} video=${videoId} cors_origin=${corsOrigin} tipo=${contentType} tamanho=${size}`
    );
    const { uploadId, uploadUrl } = await createDirectUpload(
      videoId,
      corsOrigin
    );

    await sql`
      UPDATE videos SET mux_upload_id = ${uploadId}, updated_at = now()
      WHERE id = ${videoId}
    `;

    return NextResponse.json(
      {
        uploadUrl,
        uploadId,
        videoId,
        maxBytes: MAX_VIDEO_BYTES,
        /* Diagnóstico: o cliente regista no console para detectar
           desfasamentos de origem (CORS) entre página e Mux. */
        corsOrigin,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return NextResponse.json(
        {
          error:
            'A funcionalidade de vídeo ainda não está ativa — corre scripts/migrate-fase20-busbt.js no Neon.',
        },
        { status: 503 }
      );
    }
    console.error('[API /api/upload/video] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível iniciar o upload agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}
