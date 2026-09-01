'use client';

/**
 * AngoStart — Helper de upload via CLIENTE (@vercel/blob/client).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Fluxo em 2 passos que contorna o limite de 4.5 MB de corpo das
 * funções serverless da Vercel:
 *   1. POST para a rota handleUpload (apenas emite um token curto).
 *   2. upload() do browser → URL pré-assinado do Blob diretamente.
 * ═══════════════════════════════════════════════════════════════════
 *
 * 🎯 FIABILIDADE (redes móveis 4G angolanas):
 * - Validação local ANTES de tentar (tipo + tamanho) — sem desperdiçar
 *   dados móveis com pedidos que vão falhar.
 * - Retry automático (2 repetições com backoff) APENAS para erros
 *   transitórios (rede, timeout, 5xx) — nunca para erros definitivos
 *   (ficheiro inválido/demasiado grande).
 * - Timeout configurável (AbortController) para detetar ligações caídas.
 * - Mensagens de erro CLARAS por categoria, em pt-PT.
 */

import { upload } from '@vercel/blob/client';
import { authHeaders } from '@/context/AuthContext';

export type UploadErrorKind =
  | 'network' // ligação caiu / sem internet
  | 'timeout' // demorou demasiado
  | 'too-large' // ficheiro acima do limite
  | 'invalid' // tipo/extensão não suportada
  | 'server' // erro do servidor (5xx) — retry pode ajudar
  | 'cancelled'; // o utilizador cancelou

export interface UploadSuccess {
  ok: true;
  /** URL final a guardar na base de dados. */
  url: string;
  /** Pathname real do blob (com sufixo aleatório). */
  pathname: string;
  /** Tamanho do ficheiro em bytes. */
  size: number;
}

export interface UploadFailure {
  ok: false;
  /** Mensagem amigável em pt-PT pronta a mostrar ao utilizador. */
  error: string;
  kind: UploadErrorKind;
}

export interface SmartUploadOptions {
  /** Ficheiro selecionado pelo utilizador. */
  file: File;
  /** Pathname completo no Blob (ex.: `produtos/12/173…-foto.jpg`). */
  pathname: string;
  /** Rota do servidor que implementa handleUpload(). */
  handleUploadUrl: string;
  /** Limite de tamanho em bytes (validado localmente). */
  maxBytes: number;
  /** MIME types permitidos (validado localmente). */
  allowedTypes: readonly string[];
  /** Converte pathname+blobUrl no URL final a guardar na BD. */
  makeUrl: (pathname: string, blobUrl: string) => string;
  /** Timeout total do upload em ms (padrão 120 s). */
  timeoutMs?: number;
  /** Tentativas totais (padrão 3 = 1 + 2 retries). */
  maxAttempts?: number;
  /** Progresso 0–100 (opcional, para barra de progresso). */
  onProgress?: (percentage: number) => void;
  /** AbortSignal externo para cancelar. */
  signal?: AbortSignal;
}

const RETRYABLE_KINDS: UploadErrorKind[] = ['network', 'timeout', 'server'];

/** Sanitiza o nome do ficheiro (mesma regra do servidor antigo). */
export function safeFileName(name: string, fallback: string): string {
  return (name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

/**
 * Classifica um erro de rede/upload numa categoria amigável.
 */
function classifyError(error: unknown): UploadFailure {
  const raw =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      ok: false,
      error: 'O envio demorou demasiado tempo. Verifica a tua ligação e tenta novamente.',
      kind: 'timeout',
    };
  }

  // Erros de rede do fetch (TypeError: Failed to fetch, ERR_INTERNET_DISCONNECTED…)
  if (
    /failed to fetch|networkerror|network error|internet|offline|load failed|connection/.test(
      raw
    )
  ) {
    return {
      ok: false,
      error: 'A tua ligação à internet caiu. Verifica a rede e tenta novamente.',
      kind: 'network',
    };
  }

  // Erros HTTP com estado embutido (o SDK lança "Unexpected status code: 413" etc.)
  const statusMatch = raw.match(/(\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 413 || status === 422) {
      return {
        ok: false,
        error: 'O ficheiro é demasiado grande para o servidor. Usa um ficheiro menor.',
        kind: 'too-large',
      };
    }
    if (status >= 500) {
      return {
        ok: false,
        error: 'O servidor está com problemas momentâneos. Tenta novamente daqui a pouco.',
        kind: 'server',
      };
    }
    if (status === 429) {
      return {
        ok: false,
        error: 'Demasiadas tentativas seguidas. Aguarda alguns minutos antes de voltar a tentar.',
        kind: 'server',
      };
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: 'A tua sessão expirou. Entra novamente na conta e tenta de novo.',
        kind: 'invalid',
      };
    }
  }

  // Mensagens conhecidas do SDK do Blob
  if (/too large|maximum size|exceeds/.test(raw)) {
    return {
      ok: false,
      error: 'O ficheiro excede o tamanho máximo permitido.',
      kind: 'too-large',
    };
  }
  if (/content type|allowedcontenttype|mime/.test(raw)) {
    return {
      ok: false,
      error: 'O formato do ficheiro não é suportado.',
      kind: 'invalid',
    };
  }

  return {
    ok: false,
    error: 'Não foi possível enviar o ficheiro. Tenta novamente.',
    kind: 'server',
  };
}

/** Espera `ms` milissegundos (backoff entre retries). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Valida o ficheiro localmente (barato, antes de gastar dados móveis).
 */
export function validateFileLocally(
  file: File,
  maxBytes: number,
  allowedTypes: readonly string[],
  acceptExtensions?: readonly string[]
): UploadFailure | null {
  if (file.size === 0) {
    return { ok: false, error: 'O ficheiro está vazio — escolhe outro.', kind: 'invalid' };
  }
  if (file.size > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `O ficheiro tem ${(file.size / (1024 * 1024)).toFixed(1)} MB — o limite é ${maxMb} MB. Escolhe um ficheiro mais leve.`,
      kind: 'too-large',
    };
  }
  const mime = (file.type || '').toLowerCase();
  if (mime && !(allowedTypes as readonly string[]).includes(mime)) {
    return {
      ok: false,
      error: 'Formato não suportado. Verifica o tipo de ficheiro aceito.',
      kind: 'invalid',
    };
  }
  if (acceptExtensions && acceptExtensions.length > 0) {
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (!acceptExtensions.includes(extension)) {
      return {
        ok: false,
        error: `Extensão .${extension} não suportada — usa: ${acceptExtensions.map((e) => `.${e}`).join(', ')}.`,
        kind: 'invalid',
      };
    }
  }
  return null;
}

/**
 * Upload inteligente via cliente com validação, retry e erros claros.
 */
export async function uploadFileSmart(
  options: SmartUploadOptions
): Promise<UploadSuccess | UploadFailure> {
  const {
    file,
    pathname,
    handleUploadUrl,
    maxBytes,
    allowedTypes,
    makeUrl,
    timeoutMs = 120_000,
    maxAttempts = 3,
    onProgress,
    signal,
  } = options;

  // 1. Validação local — sem gastar dados móveis se já vai falhar
  const localError = validateFileLocally(file, maxBytes, allowedTypes);
  if (localError) return localError;

  // 2. Tentativas com retry para erros transitórios
  let lastFailure: UploadFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Propaga cancelamento externo
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const blob = await upload(pathname, file, {
        access: 'private',
        handleUploadUrl,
        headers: authHeaders(), // Bearer JWT para a emissão do token
        signal: controller.signal,
        onUploadProgress: onProgress
          ? (event) => {
              if (event.percentage !== undefined) {
                onProgress(Math.min(100, Math.round(event.percentage)));
              }
            }
          : undefined,
      });

      clearTimeout(timeoutId);
      return {
        ok: true,
        url: makeUrl(blob.pathname, blob.url),
        pathname: blob.pathname,
        size: file.size,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const failure = classifyError(error);
      lastFailure = failure;

      // Cancelamento externo — não repetir
      if (signal?.aborted) {
        return { ok: false, error: 'Envio cancelado.', kind: 'cancelled' };
      }

      const isLastAttempt = attempt >= maxAttempts;
      if (!isLastAttempt && RETRYABLE_KINDS.includes(failure.kind)) {
        // Backoff progressivo: 1ª retry após 1 s, 2ª após 2.5 s
        await sleep(attempt === 1 ? 1_000 : 2_500);
        continue;
      }
      return failure;
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  return (
    lastFailure ?? {
      ok: false,
      error: 'Não foi possível enviar o ficheiro. Tenta novamente.',
      kind: 'server',
    }
  );
}
