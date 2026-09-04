import 'server-only';
import { sql } from '@/lib/db';
import {
  getAssetStatus,
  getUploadStatus,
  isMuxConfigured,
  type AssetInfo,
} from '@/lib/mux';

/**
 * AngoStart — Helper da tabela `videos` (Busbt / Mux).
 *
 * Segue o padrão de keywords-db: se o deploy chegar à Vercel ANTES de
 * `node scripts/migrate-fase20-busbt.js` correr no Neon, o site NÃO
 * parte — as rotas detectam a tabela em falta (erro 42P01) e respondem
 * com degradação graciosa (lista vazia / erro claro ao publicar).
 */

export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'errored';

export interface VideoRow {
  id: string;
  user_id: number;
  title: string;
  description: string | null;
  status: VideoStatus;
  mux_upload_id: string | null;
  mux_asset_id: string | null;
  playback_id: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
}

/** TRUE quando o erro é "tabela videos não existe" (migração pendente). */
export function isUndefinedTableError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (code === '42P01') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('does not exist') && msg.includes('videos');
}

/* Memo por processo: depois da 1.ª falha evita repetir o SELECT. */
const globalForVideos = globalThis as unknown as {
  angostartVideosUnavailable: boolean | undefined;
};

export function markVideosUnavailable(): void {
  globalForVideos.angostartVideosUnavailable = true;
}

export function videosUnavailable(): boolean {
  return globalForVideos.angostartVideosUnavailable === true;
}

/** Verifica (uma vez por processo) se a tabela videos já existe. */
export async function videosReady(): Promise<boolean> {
  if (videosUnavailable()) return false;
  try {
    await sql`SELECT 1 FROM videos LIMIT 1`;
    return true;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return false;
    }
    throw error;
  }
}

/** Metadados públicos do autor de um vídeo (JOIN users). */
export const VIDEO_AUTHOR_COLUMNS = sql`u.name AS author_name, u.username AS author_username, u.role AS author_role, u.is_verified_bi::boolean AS author_verified`;

/* ────────────────── Manutenção: uploads presos ────────────────── */

export interface SweptVideo {
  id: string;
  user_id: number;
  title: string;
}

/**
 * TIMEOUT AUTOMÁTICO (regra dos 15 minutos): uploads 'uploading' mais
 * velhos que `timeoutMinutes` passam a 'errored' — evita cartões
 * "A finalizar envio…" infinitos quando o PUT nunca terminou.
 *
 * - Só afeta 'uploading' — 'processing' ativo NUNCA é mexido aqui.
 * - Se o PUT ainda estiver a decorrer (rede lenta), o confirm final
 *   volta a colocar 'processing'/'ready' pelo estado real do Mux.
 * - Devolve as linhas transicionadas (para notificar o utilizador).
 * - `userId = null` → varre TODOS os utilizadores (uso admin/cron).
 */
export async function sweepTimedOutUploads(
  userId: number | null = null,
  timeoutMinutes = 15
): Promise<SweptVideo[]> {
  try {
    const message = `Envio expirado — o vídeo não foi concluído em ${timeoutMinutes} minutos.`;
    const rows = (await sql`
      UPDATE videos
      SET status = 'errored',
          error_message = COALESCE(error_message, ${message}),
          updated_at = now()
      WHERE status = 'uploading'
        AND created_at < now() - (${timeoutMinutes} * interval '1 minute')
        AND (${userId}::int IS NULL OR user_id = ${userId}::int)
      RETURNING id, user_id, title
    `) as unknown as SweptVideo[];
    return rows;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return [];
    }
    throw error;
  }
}

export interface VerifiedTransition {
  videoId: string;
  userId: number;
  title: string;
  from: VideoStatus;
  to: VideoStatus;
}

const PENDING_DEAD_UPLOAD = new Set(['errored', 'cancelled', 'timed_out']);

/* ─── Core partilhado: verifica UMA linha contra o Mux ─── */

async function verifyRowsAtMux(
  pending: VideoRow[]
): Promise<VerifiedTransition[]> {
  const transitions: VerifiedTransition[] = [];

  for (const v of pending) {
    try {
      let assetId: string | null = v.mux_asset_id;

      /* Sem asset ainda — pergunta ao Mux se o Direct Upload já criou um. */
      if (!assetId && v.mux_upload_id) {
        const upload = await getUploadStatus(v.mux_upload_id);
        if (upload.assetId) {
          assetId = upload.assetId;
        } else if (upload.status && PENDING_DEAD_UPLOAD.has(upload.status)) {
          const updated = (await sql`
            UPDATE videos
            SET status = 'errored',
                error_message = ${`Upload no Mux: ${upload.status}`},
                updated_at = now()
            WHERE id = ${v.id} AND status IN ('uploading', 'processing')
            RETURNING user_id, title
          `) as unknown as { user_id: number; title: string }[];
          if (updated[0]) {
            transitions.push({
              videoId: v.id,
              userId: updated[0].user_id,
              title: updated[0].title,
              from: v.status as VideoStatus,
              to: 'errored',
            });
          }
          continue;
        } else {
          continue; /* ainda 'waiting' — o PUT pode estar a decorrer */
        }
      }
      if (!assetId) continue;

      const asset: AssetInfo = await getAssetStatus(assetId);

      if (asset.status === 'ready') {
        const updated = (await sql`
          UPDATE videos
          SET status = 'ready',
              mux_asset_id = COALESCE(${assetId}, mux_asset_id),
              playback_id = COALESCE(${asset.playbackId}, playback_id),
              duration_seconds = ${asset.durationSeconds},
              max_stored_resolution = COALESCE(${asset.maxStoredResolution}, max_stored_resolution),
              error_message = NULL,
              updated_at = now()
          WHERE id = ${v.id} AND status IN ('uploading', 'processing')
          RETURNING user_id, title
        `) as unknown as { user_id: number; title: string }[];
        if (updated[0]) {
          transitions.push({
            videoId: v.id,
            userId: updated[0].user_id,
            title: updated[0].title,
            from: v.status as VideoStatus,
            to: 'ready',
          });
        }
      } else if (asset.status === 'errored') {
        const updated = (await sql`
          UPDATE videos
          SET status = 'errored',
              mux_asset_id = COALESCE(${assetId}, mux_asset_id),
              error_message = COALESCE(${asset.errorMessage}, 'Processamento falhou no Mux.'),
              updated_at = now()
          WHERE id = ${v.id} AND status IN ('uploading', 'processing')
          RETURNING user_id, title
        `) as unknown as { user_id: number; title: string }[];
        if (updated[0]) {
          transitions.push({
            videoId: v.id,
            userId: updated[0].user_id,
            title: updated[0].title,
            from: v.status as VideoStatus,
            to: 'errored',
          });
        }
      } else if (asset.status === 'processing' && v.status === 'uploading') {
        await sql`
          UPDATE videos
          SET status = 'processing',
              mux_asset_id = COALESCE(${assetId}, mux_asset_id),
              updated_at = now()
          WHERE id = ${v.id} AND status = 'uploading'
        `;
      }
      /* asset 'creating'/outros — nada a fazer ainda */
    } catch (error) {
      console.warn(`[videos-db] verifyRowsAtMux: falha ao verificar ${v.id}:`, error);
      continue;
    }
  }

  return transitions;
}

/**
 * SELF-HEALING: verifica no Mux os vídeos pendentes do utilizador
 * quando o webhook pode não ter chegado (rede, retries perdidos).
 *
 * - Grace de 2 min (o webhook costuma chegar em segundos) — evita
 *   chamadas ao Mux por vídeos acabados de criar.
 * - Máx. 5 vídeos por chamada (protege o rate limit da API do Mux).
 * - ready → guarda playback_id; errored → guarda mensagem;
 *   upload morto no Mux (errored/cancelled/timed_out) → 'errored'.
 * - Melhor-esforço: 1 linha problemática nunca quebra a listagem.
 */
export async function verifyPendingAtMux(
  userId: number,
  opts: { graceMinutes?: number; max?: number; videoId?: string } = {}
): Promise<VerifiedTransition[]> {
  if (!isMuxConfigured()) return [];
  const { graceMinutes = 2, max = 5, videoId } = opts;

  let pending: VideoRow[];
  try {
    pending = (await sql`
      SELECT id, user_id, title, status::text AS status, mux_upload_id,
             mux_asset_id, playback_id, error_message, created_at
      FROM videos
      WHERE user_id = ${userId}
        AND status IN ('uploading', 'processing')
        AND created_at < now() - (${graceMinutes} * interval '1 minute')
        AND (${videoId ?? null}::text IS NULL OR id = ${videoId ?? null}::text)
      ORDER BY created_at ASC
      LIMIT ${max}
    `) as unknown as VideoRow[];
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return [];
    }
    throw error;
  }

  return verifyRowsAtMux(pending);
}

/* ─────── Varredura GLOBAL (cron 60 s — correcção do Busbt preso) ─────── */

/**
 * Varredura GLOBAL de vídeos presos, consultando o Mux diretamente
 * (não depende do webhook). É a espinha dorsal da correção do
 * «A finalizar envio…» eterno:
 *
 *  - Seleciona vídeos 'uploading' (PUT nunca confirmado) e
 *    'processing' (webhook ready perdido) com mais de `staleMinutes`.
 *  - Consulta o Mux vídeo a vídeo e aplica o estado REAL:
 *    ready → playback_id; errored → mensagem; asset a processar →
 *    mantém 'processing'; upload morto → 'errored'.
 *  - `userId = null` → TODOS os utilizadores (uso do cron).
 *  - Máx. `max` vídeos por corrida (protege o rate limit do Mux).
 */
export async function verifyAllStaleAtMux(
  staleMinutes = 5,
  max = 20,
  userId: number | null = null
): Promise<VerifiedTransition[]> {
  if (!isMuxConfigured()) return [];

  let pending: VideoRow[];
  try {
    pending = (await sql`
      SELECT id, user_id, title, status::text AS status, mux_upload_id,
             mux_asset_id, playback_id, error_message, created_at
      FROM videos
      WHERE status IN ('uploading', 'processing')
        AND created_at < now() - (${staleMinutes} * interval '1 minute')
        AND (${userId}::int IS NULL OR user_id = ${userId}::int)
      ORDER BY created_at ASC
      LIMIT ${max}
    `) as unknown as VideoRow[];
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return [];
    }
    throw error;
  }

  return verifyRowsAtMux(pending);
}

/* ── Auto-verificação oportunista (≤ 1× / 60 s por instância) ── */

const globalForVideosSweep = globalThis as unknown as {
  angostartLastAutoSweep: number | undefined;
};

/**
 * AUTO-VERIFICAÇÃO A CADA 60 SEGUNDOS (sem depender do cron):
 * qualquer pedido autenticado à lista «Os Meus Vídeos» dispara esta
 * varredura global — no máximo UMA vez por minuto por instância
 * serverless (throttle em memória). Consulta o Mux diretamente para
 * vídeos 'uploading'/'processing' com mais de 5 minutos e aplica o
 * estado real. Totalmente melhor-esforço: NUNCA quebra a resposta.
 */
export async function maybeAutoVerifyStaleVideos(): Promise<void> {
  const now = Date.now();
  const last = globalForVideosSweep.angostartLastAutoSweep ?? 0;
  if (now - last < 60_000) return; /* já varreu há menos de 60 s */
  globalForVideosSweep.angostartLastAutoSweep = now;
  try {
    /* Máx. 5 vídeos (≤ 10 chamadas ao Mux, ~2 s no pior caso) e SÓ
       quando existem vídeos presos — caso contrário o SELECT devolve
       0 linhas e o custo é ~50 ms. O cron de 60 s é o mecanismo
       primário; esta varredura é a rede de segurança sem cron. */
    const transitions = await verifyAllStaleAtMux(5, 5);
    if (transitions.length > 0) {
      console.info(
        `[videos-db] auto-verificação 60 s: ${transitions.length} vídeo(s) ` +
          `atualizado(s) diretamente no Mux (${transitions
            .map((t) => `${t.videoId}→${t.to}`)
            .join(', ')})`
      );
    }
  } catch {
    /* melhor-esforço — silencioso por design */
  }
}
