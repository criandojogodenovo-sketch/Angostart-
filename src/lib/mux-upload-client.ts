/**
 * AngoStart — Upload direto de vídeo para o Mux (client-safe).
 *
 * ⚠️ Client-side: este módulo corre no browser — NUNCA importar aqui
 * segredos (MUX_TOKEN_*). O cliente recebe apenas o URL assinado de
 * Direct Upload criado por POST /api/upload/video (server-only).
 *
 * Robustez (fix "Erro de rede durante o envio do vídeo para o Mux"):
 *  - Timeout de 120 s por tentativa (XHR nativo — semântica do
 *    AbortController para pedidos com upload-progress).
 *  - Retry com backoff exponencial: até 3 tentativas extra (1 s, 2 s, 4 s)
 *    em falhas de rede/timeout/5xx; 4xx não é repetido (rejeição definitiva).
 *  - Content-Type resolvido pela extensão quando o browser não informa
 *    o MIME (WebViews móveis costumam enviar File.type vazio).
 *  - Logs detalhados no console: origens (página vs Mux — detecta CORS),
 *    estado HTTP, corpo da resposta e nº da tentativa.
 */

/** MIME types aceites (espelho de ALLOWED_VIDEO_TYPES em lib/mux.ts). */
export const ACCEPTED = 'video/mp4,video/webm,video/quicktime';
/** Limite de 100 MB (espelho de MAX_VIDEO_BYTES em lib/mux.ts). */
export const MAX_BYTES = 100 * 1024 * 1024;

/** Timeout do PUT (equivale a AbortController de 120 s — XHR nativo). */
export const UPLOAD_TIMEOUT_MS = 120_000;
/** Backoff exponencial entre tentativas: 1 s → 2 s → 4 s. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** MIME a partir da extensão — alguns WebViews devolvem File.type vazio. */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
};

export function resolveVideoMime(file: { type?: string; name: string }): string {
  if (file.type && ACCEPTED.split(',').includes(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'video/mp4';
}

/** TRUE quando o ficheiro é aceitável (MIME conhecido OU extensão conhecida). */
export function isAcceptableVideoFile(file: { type?: string; name: string }): boolean {
  if (file.type && ACCEPTED.split(',').includes(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ext in MIME_BY_EXT;
}

/** Erro classificado do PUT — permite decidir retry e mensagem certa. */
export class MuxUploadError extends Error {
  kind: 'network' | 'timeout' | 'http';
  status?: number;
  responseBody?: string;

  constructor(
    kind: 'network' | 'timeout' | 'http',
    message: string,
    status?: number,
    responseBody?: string
  ) {
    super(message);
    this.name = 'MuxUploadError';
    this.kind = kind;
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Origem de um URL sem lançar (para logs de diagnóstico CORS). */
export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'origem-inválida';
  }
}

/** Uma tentativa de PUT (XHR para ter progresso real de upload). */
function putFileOnce(
  uploadUrl: string,
  file: File,
  mime: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    /* Content-Type correto conforme pedido pelo Mux; Content-Length é
       definido automaticamente pelo browser (header proibido de definir). */
    xhr.setRequestHeader('Content-Type', mime);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      /* 5xx é retryable; 4xx é rejeição definitiva do Mux. */
      const hint =
        xhr.status === 400 || xhr.status === 403
          ? 'O URL de upload pode ter expirado — publica novamente.'
          : 'O Mux recusou o ficheiro.';
      reject(
        new MuxUploadError(
          'http',
          `${hint} (HTTP ${xhr.status}).`,
          xhr.status,
          xhr.responseText?.slice(0, 300)
        )
      );
    };
    /* onerror dispara para queda de rede OU bloqueio de CORS (o browser
       esconde o detalhe) — o log distingue com as origens. */
    xhr.onerror = () =>
      reject(
        new MuxUploadError(
          'network',
          'A ligação à internet caiu durante o envio. Verifica a tua rede e tenta novamente.'
        )
      );
    xhr.ontimeout = () =>
      reject(
        new MuxUploadError(
          'timeout',
          'O envio demorou mais de 2 minutos e foi cancelado. Tenta com um vídeo mais pequeno ou numa ligação mais rápida.'
        )
      );
    xhr.onabort = () =>
      reject(new MuxUploadError('network', 'O envio foi cancelado.'));
    xhr.send(file);
  });
}

/**
 * PUT para o Mux com retry (3 tentativas extras: 1 s, 2 s, 4 s),
 * timeout de 120 s por tentativa e logs de diagnóstico no console.
 */
export async function putFileToMux(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  const mime = resolveVideoMime(file);
  const diagnostics = {
    urlOrigin: safeOrigin(uploadUrl),
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    sizeMB: Math.round((file.size / (1024 * 1024)) * 100) / 100,
    mime,
  };
  console.info('[Busbt] Início do upload para o Mux', diagnostics);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await putFileOnce(uploadUrl, file, mime, onProgress);
      if (attempt > 0) {
        console.info(`[Busbt] Upload concluído na tentativa ${attempt + 1}.`);
      }
      return;
    } catch (error) {
      const err =
        error instanceof MuxUploadError
          ? error
          : new MuxUploadError('network', String(error));
      /* Log detalhado (F12 → Console) para capturar a resposta exata do Mux. */
      console.error('[Busbt] Upload Mux falhou', {
        attempt: attempt + 1,
        maxAttempts: RETRY_DELAYS_MS.length + 1,
        status: err.status ?? null,
        kind: err.kind,
        message: err.message,
        responseBody: err.responseBody ?? null,
        ...diagnostics,
        error: err,
      });

      const retryable =
        err.kind === 'network' ||
        err.kind === 'timeout' ||
        (err.kind === 'http' && (err.status ?? 0) >= 500);
      const lastAttempt = attempt === RETRY_DELAYS_MS.length;
      if (!retryable || lastAttempt) throw err;

      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[Busbt] Nova tentativa em ${delay / 1000} s (falhou ${err.kind})…`
      );
      onProgress(0);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  /* Inalcançável — o loop sempre lança ou resolve. */
  throw new MuxUploadError('network', 'O envio do vídeo falhou.');
}
