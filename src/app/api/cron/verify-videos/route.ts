import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { isMuxConfigured } from '@/lib/mux';
import { pushNotification } from '@/lib/notifications';
import {
  isUndefinedTableError,
  markVideosUnavailable,
  verifyAllStaleAtMux,
  type VerifiedTransition,
} from '@/lib/videos-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/verify-videos — CORRECÇÃO DO BUG «A finalizar envio…»
 * (upload do Busbt preso para sempre).
 *
 * Agendada no vercel.json para correr A CADA 60 SEGUNDOS. Consulta o Mux
 * DIRETAMENTE (não depende do webhook — se o MUX_WEBHOOK_SECRET estiver
 * errado na Vercel, ou um evento se perder na rede, os vídeos continuam
 * a sincronizar por aqui):
 *
 *  1. Seleciona vídeos 'uploading' (PUT nunca confirmado) e 'processing'
 *     (webhook «ready» perdido) com MAIS DE 5 MINUTOS.
 *  2. Pergunta ao Mux o estado real de cada um (upload + asset).
 *  3. Atualiza a BD: ready → playback_id (aparece na lista e na grelha
 *     pública); errored → mensagem; a processar → mantém. Limite de 20
 *     vídeos por corrida (protege o rate limit do Mux).
 *  4. Notifica os donos das falhas detetadas (sino + web push).
 *
 * 🔒 Proteção: header `Authorization: Bearer $CRON_SECRET` (a Vercel
 * envia automaticamente quando CRON_SECRET está definida). Sem
 * CRON_SECRET, só é permitido em desenvolvimento.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();

  if (cronSecret) {
    if (bearer !== cronSecret) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET não configurada — cron desativado em produção.' },
      { status: 403 }
    );
  }

  if (!isMuxConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'MUX_TOKEN_ID/MUX_TOKEN_SECRET ausentes — integração de vídeo não configurada.',
      },
      { status: 503 }
    );
  }

  const startedAt = Date.now();
  try {
    /* 1+2+3 — varredura global: pendentes > 5 min, direto no Mux. */
    const transitions: VerifiedTransition[] = await verifyAllStaleAtMux(5, 20);

    /* Quantos continuam pendentes (para monitorização no dashboard
       da Vercel → Observability → Logs). */
    let stillPending = -1;
    try {
      const rows = (await sql`
        SELECT COUNT(*)::int AS n
        FROM videos
        WHERE status IN ('uploading', 'processing')
          AND created_at < now() - interval '5 minutes'
      `) as unknown as { n: number }[];
      stillPending = rows[0]?.n ?? 0;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        markVideosUnavailable();
        stillPending = 0;
      }
    }

    /* 4 — notifica os donos dos vídeos que falharam (melhor-esforço). */
    let notified = 0;
    for (const t of transitions) {
      if (t.to !== 'errored') continue;
      try {
        await pushNotification(
          t.userId,
          'O teu vídeo não foi publicado',
          `«${t.title || 'Sem título'}» falhou no processamento. Tenta publicar novamente.`,
          '/busbt'
        );
        notified += 1;
      } catch {
        /* notificação opcional — o cron responde sempre */
      }
    }

    const summary = {
      ok: true,
      checked: transitions.length,
      ready: transitions.filter((t) => t.to === 'ready').length,
      errored: transitions.filter((t) => t.to === 'errored').length,
      processing: transitions.filter((t) => t.to === 'processing').length,
      stillPending,
      notified,
      ms: Date.now() - startedAt,
      date: new Date().toISOString(),
    };
    if (transitions.length > 0) {
      console.info('[cron/verify-videos] Varredura concluída:', summary);
    }
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[cron/verify-videos] Erro:', error);
    return NextResponse.json(
      { error: 'Falha na verificação automática de vídeos.' },
      { status: 503 }
    );
  }
}
