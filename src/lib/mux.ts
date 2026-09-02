import 'server-only';

/**
 * AngoStart — Cliente Mux (server-only)
 *
 * ⚠️ SERVER-ONLY: lê MUX_TOKEN_ID e MUX_TOKEN_SECRET — protegido pelo
 * pacote `server-only`, o build falha se um Client Component tentar
 * importar este módulo. O segredo NUNCA chega ao browser.
 *
 * Responsabilidades:
 *  - createDirectUpload()   → Direct Upload do Mux (o browser faz PUT
 *                             do ficheiro diretamente para o Mux — o
 *                             vídeo não passa pelo servidor da Vercel).
 *  - getUploadStatus()      → estado do Direct Upload (asset_id quando
 *                             o upload termina).
 *  - getAssetStatus()       → estado do Asset (processing/ready/errored,
 *                             playback_id, duração).
 *  - playbackUrls()         → URLs públicos de stream + thumbnail.
 *  - deleteAsset()          → elimina o asset (e as suas rendições).
 *  - verifyWebhookSignature() → valida o header Mux-Signature
 *                             (HMAC-SHA256, timing-safe) do webhook.
 *
 * Degradação graciosa: sem MUX_TOKEN_ID/MUX_TOKEN_SECRET o módulo não
 * lança erros no import — `isMuxConfigured()` devolve false e as rotas
 * respondem 503 com instrução clara (o resto do site continua normal).
 */

import Mux from '@mux/mux-node';

/* ───────────────────────── Configuração ───────────────────────── */

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB (plano free Mux)

/** Tipos MIME aceites para publicidade em vídeo. */
export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export type AllowedVideoType = (typeof ALLOWED_VIDEO_TYPES)[number];

export function isAllowedVideoType(input: unknown): input is AllowedVideoType {
  return (
    typeof input === 'string' &&
    (ALLOWED_VIDEO_TYPES as readonly string[]).includes(input)
  );
}

/** TRUE quando as credenciais Mux existem no ambiente. */
export function isMuxConfigured(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

/* Singleton do SDK — criado apenas na 1.ª chamada (lazy). */
const globalForMux = globalThis as unknown as {
  angostartMux: Mux | undefined;
};

function getMux(): Mux {
  if (!isMuxConfigured()) {
    throw new MuxNotConfiguredError();
  }
  globalForMux.angostartMux ??= new Mux({
    tokenId: process.env.MUX_TOKEN_ID!,
    tokenSecret: process.env.MUX_TOKEN_SECRET!,
  });
  return globalForMux.angostartMux;
}

export class MuxNotConfiguredError extends Error {
  constructor() {
    super(
      'Integração de vídeo não configurada: define MUX_TOKEN_ID e MUX_TOKEN_SECRET nas variáveis de ambiente.'
    );
    this.name = 'MuxNotConfiguredError';
  }
}

/* ─────────────────────── Direct Upload ─────────────────────────── */

export interface DirectUploadResult {
  uploadId: string;
  uploadUrl: string;
}

/**
 * Cria um Direct Upload no Mux.
 * O cliente faz `PUT uploadUrl` com o ficheiro — sem passar pelo servidor.
 *
 * @param passthrough  ID interno (videos.id) devolvido nos webhooks.
 * @param corsOrigin   origin autorizada para o PUT do browser.
 */
export async function createDirectUpload(
  passthrough: string,
  corsOrigin: string
): Promise<DirectUploadResult> {
  const mux = getMux();
  const upload = await mux.video.uploads.create({
    cors_origin: corsOrigin,
    new_asset_settings: {
      playback_policies: ['public'],
      /* passthrough viaja no webhook — identifica a linha videos.id
         (limite do Mux: 100 caracteres; UUID tem 36). */
      passthrough: passthrough.slice(0, 100),
    },
  });
  if (!upload?.url || !upload?.id) {
    throw new Error('Mux não devolveu o URL de upload.');
  }
  return { uploadId: upload.id, uploadUrl: upload.url };
}

/**
 * Estado de um Direct Upload. `assetId` fica definido quando o cliente
 * terminou o PUT (upload.status === 'asset_created').
 */
export async function getUploadStatus(uploadId: string): Promise<{
  status: string | null;
  assetId: string | null;
}> {
  const mux = getMux();
  const upload = await mux.video.uploads.retrieve(uploadId);
  return {
    status: upload?.status ?? null,
    assetId: upload?.asset_id ?? null,
  };
}

/* ───────────────────────────── Assets ──────────────────────────── */

export interface AssetInfo {
  status: string | null; // preparing | ready | errored
  playbackId: string | null;
  durationSeconds: number | null;
  maxStoredResolution: string | null;
  errorMessage: string | null;
}

/** Detalhes de um asset (processamento, playback, duração). */
export async function getAssetStatus(assetId: string): Promise<AssetInfo> {
  const mux = getMux();
  const asset = await mux.video.assets.retrieve(assetId);
  return {
    status: asset?.status ?? null,
    playbackId: asset?.playback_ids?.[0]?.id ?? null,
    durationSeconds:
      typeof asset?.duration === 'number'
        ? Math.round(asset.duration * 100) / 100
        : null,
    maxStoredResolution: asset?.max_stored_resolution ?? null,
    errorMessage: asset?.errors?.messages?.[0] ?? null,
  };
}

/** Elimina o asset no Mux (as rendições/CDN são removidas junto). */
export async function deleteAsset(assetId: string): Promise<void> {
  const mux = getMux();
  await mux.video.assets.delete(assetId);
}

/* ───────────────────── URLs de playback públicos ───────────────── */

/** URL HLS de streaming (usado pelo Mux Player). */
export function createPlaybackUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

/** Thumbnail JPG vertical do vídeo (grelha Busbt). */
export function createThumbnailUrl(
  playbackId: string,
  width = 480,
  height = 854
): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=${height}&fit_mode=pad&smart_crop=true`;
}

/* ───────────────────────────── Webhook ─────────────────────────── */

/**
 * Valida o header `Mux-Signature` (t=<ts>,v1=<hmac>) contra o
 * MUX_WEBHOOK_SECRET — HMAC-SHA256 timing-safe + janela de 5 min,
 * via SDK oficial (só precisa do segredo do webhook, não do token).
 */
export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers
): Promise<boolean> {
  const secret = process.env.MUX_WEBHOOK_SECRET;
  if (!secret) return false;
  try {
    /* Cliente dedicado ao webhook: só o segredo — as credenciais de API
       não são necessárias para validar a assinatura. */
    const verifier = new Mux({ webhookSecret: secret });
    await verifier.webhooks.verifySignature(rawBody, headers);
    return true;
  } catch {
    return false;
  }
}
