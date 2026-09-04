import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyWebhookSignature } from '@/lib/mux';
import { isUndefinedTableError, markVideosUnavailable } from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mux/webhook — DIAGNÓSTICO (sem segredos).
 *
 * O Mux só envia POST; este GET existe para confirmar em produção se a
 * configuração está completa — a causa nº 1 do «vídeo preso em
 * uploading» é MUX_WEBHOOK_SECRET ausente/diferente na Vercel, e sem
 * isto não há forma de distinguir «webhook não configurado» de
 * «assinatura inválida». Devolve APENAS booleans, nunca valores.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/mux/webhook',
    method: 'POST (Mux)',
    muxTokenConfigured: Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET),
    webhookSecretConfigured: Boolean(process.env.MUX_WEBHOOK_SECRET),
    hint: !process.env.MUX_WEBHOOK_SECRET
      ? 'MUX_WEBHOOK_SECRET não definido na Vercel — TODOS os webhooks são rejeitados (401). Copia o valor do painel Mux (Settings → Webhooks) para a Vercel.'
      : 'Segredo presente. Se os vídeos continuarem presos, confirma que o valor coincide EXACTAMENTE com o painel Mux e que o URL do webhook é https://<dominio>/api/mux/webhook.',
    selfHealing: 'Ativo — cron /api/cron/verify-videos a cada 60 s + auto-verificação na listagem.',
  });
}

/**
 * POST /api/mux/webhook — recebe eventos do Mux (configurado no painel
 * Mux → Settings → Webhooks → https://angostart.vercel.app/api/mux/webhook).
 *
 * Segurança: header `Mux-Signature` validado com MUX_WEBHOOK_SECRET
 * (HMAC-SHA256 timing-safe + janela de 5 minutos) — eventos forjados
 * são rejeitados com 401. O corpo é lido como TEXTO BRUTO (a assinatura
 * HMAC cobre os bytes exatos; JSON.parse só depois de verificar).
 *
 * Eventos tratados:
 *  - video.asset.ready   → status='ready' + playback_id + duração
 *  - video.asset.errored → status='errored' + mensagem
 *  - video.asset.created → (rede de segurança) regista mux_asset_id
 *
 * O vídeo é identificado por passthrough (= videos.id definido no
 * Direct Upload), com fallback para mux_asset_id.
 */

interface MuxWebhookEvent {
  type?: string;
  data?: {
    id?: string;
    passthrough?: string;
    status?: string;
    duration?: number;
    playback_ids?: { id: string; policy: string }[];
    errors?: { messages?: string[] };
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const rawBody = await request.text();

  /* 1. Assinatura — antes de qualquer processamento. */
  const valid = await verifyWebhookSignature(rawBody, request.headers);
  if (!valid) {
    /* 🔍 Diagnóstico do "vídeo preso em uploading": 401 aqui significa
       MUX_WEBHOOK_SECRET ausente/diferente na Vercel OU webhook mal
       configurado no painel do Mux — TODOS os eventos ficam bloqueados. */
    console.error(
      '[API /api/mux/webhook] 401 assinatura INVÁLIDA (bytes=' + rawBody.length + '). ' +
        'Causas: MUX_WEBHOOK_SECRET não definido na Vercel, valor diferente do ' +
        'painel Mux (Settings → Webhooks) ou proxy a alterar o corpo. ' +
        'Sem correção, os vídeos FICAM PRESOS em uploading/processing.'
    );
    return NextResponse.json(
      { error: 'Assinatura do webhook inválida.' },
      { status: 401 }
    );
  }

  let event: MuxWebhookEvent;
  try {
    event = JSON.parse(rawBody) as MuxWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const assetId = event.data?.id ?? null;
  const passthrough = event.data?.passthrough ?? null;
  const type = event.type ?? '';

  console.info(
    `[API /api/mux/webhook] evento ${type || '(sem tipo)'} asset=${assetId ?? '—'} ` +
      `passthrough=${passthrough ?? '—'}`
  );

  /* Só tratamos eventos de asset. */
  if (!type.startsWith('video.asset.')) {
    return NextResponse.json({ received: true });
  }

  try {
    /* Localiza a linha: passthrough → mux_asset_id (fallback). */
    let row: { id: string } | null = null;
    if (passthrough) {
      const rows = (await sql`
        SELECT id FROM videos WHERE id = ${passthrough} LIMIT 1
      `) as unknown as { id: string }[];
      row = rows[0] ?? null;
    }
    if (!row && assetId) {
      const rows = (await sql`
        SELECT id FROM videos WHERE mux_asset_id = ${assetId} LIMIT 1
      `) as unknown as { id: string }[];
      row = rows[0] ?? null;
    }
    if (!row) {
      /* Vídeo eliminado localmente antes do evento — resposta 200 para
         o Mux não insistir (retries). */
      console.warn(
        `[API /api/mux/webhook] ${type}: nenhum vídeo local para asset=${assetId} ` +
          'passthrough=' + (passthrough ?? '—') + ' (eliminado antes do evento?)'
      );
      return NextResponse.json({ received: true, matched: false });
    }

    if (type === 'video.asset.ready') {
      const playbackId = event.data?.playback_ids?.[0]?.id ?? null;
      const duration =
        typeof event.data?.duration === 'number'
          ? Math.round(event.data.duration * 100) / 100
          : null;
      await sql`
        UPDATE videos
        SET status = 'ready',
            playback_id = COALESCE(${playbackId}, playback_id),
            mux_asset_id = COALESCE(${assetId}, mux_asset_id),
            duration_seconds = ${duration},
            error_message = NULL,
            updated_at = now()
        WHERE id = ${row.id}
      `;
      console.info(
        `[API /api/mux/webhook] vídeo ${row.id} → READY (playback=${playbackId ?? '—'}, ` +
          `${duration ?? '?'}s, ${Date.now() - startedAt} ms)`
      );
      return NextResponse.json({ received: true, status: 'ready' });
    }

    if (type === 'video.asset.errored') {
      const message = (event.data?.errors?.messages?.[0] ?? 'Processamento falhou no Mux.').slice(0, 500);
      console.error(
        `[API /api/mux/webhook] vídeo ${row.id} → ERRORED: ${message}`
      );
      const updated = (await sql`
        UPDATE videos
        SET status = 'errored',
            mux_asset_id = COALESCE(${assetId}, mux_asset_id),
            error_message = ${message},
            updated_at = now()
        WHERE id = ${row.id}
        RETURNING user_id, title
      `) as unknown as { user_id: number; title: string }[];
      /* Notifica o dono (sino + web push) — melhor-esforço. */
      const owner = updated[0];
      if (owner) {
        try {
          const { pushNotification } = await import('@/lib/notifications');
          await pushNotification(
            owner.user_id,
            'O teu vídeo não foi publicado',
            `«${owner.title || 'Sem título'}» falhou no processamento: ${message}`,
            '/busbt'
          );
        } catch {
          /* notificação opcional — o webhook tem de responder 200 */
        }
      }
      return NextResponse.json({ received: true, status: 'errored' });
    }

    /* video.asset.created e outros: garantir o asset_id guardado. */
    if (assetId) {
      await sql`
        UPDATE videos
        SET mux_asset_id = COALESCE(mux_asset_id, ${assetId}),
            status = CASE WHEN status = 'uploading' THEN 'processing' ELSE status END,
            updated_at = now()
        WHERE id = ${row.id}
      `;
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      /* 200: sem a tabela não há nada a atualizar — evita retry infinito. */
      return NextResponse.json({ received: true, table: 'missing' });
    }
    console.error('[API /api/mux/webhook] Erro:', error);
    /* 500 → o Mux repete com backoff (comportamento desejado). */
    return NextResponse.json(
      { error: 'Erro interno ao processar o evento.' },
      { status: 500 }
    );
  }
}
