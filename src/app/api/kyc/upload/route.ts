import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireSeller, clientKey, rateLimit } from '@/lib/security';
import { KYC_MAX_FILE_MB } from '@/lib/kyc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/kyc/upload — emissão de token para CLIENT-SIDE UPLOAD da
 * FOTO do documento de identidade (BI, Passaporte ou Cartão de Eleitor).
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🚀 UPLOAD VIA CLIENTE: o browser envia a foto diretamente ao Blob
 * (upload() de @vercel/blob/client) — contorna o limite de 4.5 MB de
 * corpo serverless da Vercel e reduz o consumo da função a zero.
 * ═══════════════════════════════════════════════════════════════════
 *
 * 🔒 SEGURANÇA — documento sensível, NUNCA público:
 * - Apenas vendedores autenticados.
 * - Namespace obrigatório `kyc/<id-do-utilizador>/…`.
 * - Tipos fixados server-side (jpeg/png/webp), máx. 5 MB.
 * - Guardado com `access: 'private'` — servido APENAS por
 *   GET /api/kyc/document/[...path] (dono ou admin, sem cache pública).
 * - Rate limit: 20 tokens / 10 min por IP.
 *
 * Resposta do cliente → `/api/kyc/document/<userId>/<ficheiro>`
 * (guardado em users.kyc_document_url via POST /api/kyc/submit).
 */

const MAX_DOC_BYTES = KYC_MAX_FILE_MB * 1024 * 1024; // 5 MB

const DOC_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const DOC_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 20 tokens / 10 minutos por IP
  if (!rateLimit(clientKey(request, 'kyc-upload-token'), 20, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados uploads seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  /* ── Parse + pré-validação do evento JSON do SDK ──

     ⚠️ O ficheiro NUNCA passa por esta rota: o browser faz PUT direto
     ao Blob (upload() de @vercel/blob/client). Aqui chega apenas o
     evento JSON { type: 'blob.generate-client-token', payload: {...} }
     (ou o webhook assinado 'blob.upload-completed' da Vercel).
     O SDK (handleUpload) espera o evento JÁ PARSED — passar
     request.body (ReadableStream) fazia body.type = undefined →
     "Invalid event type" → 400 em TODOS os uploads.

     A pré-validação corre ANTES do check do BLOB token — corpo inválido
     falha rápido com 400 mesmo sem armazenamento configurado (paridade
     com /api/upload/image). */
  const peek: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const peekType =
    typeof peek === 'object' && peek !== null
      ? (peek as { type?: unknown }).type
      : undefined;
  if (
    typeof peekType !== 'string' ||
    !['blob.generate-client-token', 'blob.upload-completed'].includes(peekType)
  ) {
    return NextResponse.json(
      { error: 'Pedido de upload inválido — recarrega a página e tenta de novo.' },
      { status: 400 }
    );
  }
  // Namespace/extensão pré-validados no peek (fail-fast 400 sem Blob;
  // enforce definitivo em onBeforeGenerateToken + Blob Store).
  if (peekType !== 'blob.upload-completed') {
    const peekPathname =
      typeof (peek as { payload?: unknown }).payload === 'object' &&
      (peek as { payload?: unknown }).payload !== null
        ? (peek as { payload: { pathname?: unknown } }).payload.pathname
        : undefined;
    if (typeof peekPathname !== 'string' || peekPathname.length === 0) {
      return NextResponse.json(
        { error: 'Pedido de upload inválido — pathname em falta.' },
        { status: 400 }
      );
    }
    const ownedPrefix = `kyc/${auth.user.id}/`;
    if (!peekPathname.startsWith(ownedPrefix)) {
      return NextResponse.json(
        { error: 'Namespace de upload inválido para a tua conta.' },
        { status: 400 }
      );
    }
    const fileName = peekPathname.slice(ownedPrefix.length);
    if (fileName.length === 0 || fileName.includes('/') || fileName.includes('..')) {
      return NextResponse.json(
        { error: 'Pathname de upload inválido.' },
        { status: 400 }
      );
    }
    const peekExt = (fileName.split('.').pop() || '').toLowerCase();
    if (!DOC_EXTENSIONS.has(peekExt)) {
      return NextResponse.json(
        { error: 'Formato inválido — usa JPG, PNG ou WebP.' },
        { status: 400 }
      );
    }
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          'Armazenamento de documentos ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body: peek as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        console.debug('[API kyc/upload] Pedido de token:', {
          userId: auth.user.id,
          pathname,
        });
        // Namespace obrigatório do próprio vendedor
        const ownedPrefix = `kyc/${auth.user.id}/`;
        if (!pathname.startsWith(ownedPrefix)) {
          throw new Error('PATH_FORBIDDEN');
        }

        // Extensão válida
        const extension = (pathname.split('.').pop() || '').toLowerCase();
        if (!DOC_EXTENSIONS.has(extension)) {
          throw new Error('EXTENSION_FORBIDDEN');
        }

        return {
          allowedContentTypes: [...DOC_MIME_TYPES],
          maximumSizeInBytes: MAX_DOC_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: auth.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Auditoria (fire-and-forget). O URL é guardado em
        // users.kyc_document_url pelo POST /api/kyc/submit.
        console.log(
          '[API kyc/upload] Documento concluído:',
          blob.pathname,
          'por utilizador',
          tokenPayload
        );
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('PATH_FORBIDDEN')) {
      return NextResponse.json(
        { error: 'Namespace de upload inválido para a tua conta.' },
        { status: 400 }
      );
    }
    if (message.includes('EXTENSION_FORBIDDEN')) {
      return NextResponse.json(
        { error: 'Formato inválido — usa JPG, PNG ou WebP.' },
        { status: 400 }
      );
    }
    if (/body|payload|invalid/i.test(message)) {
      return NextResponse.json(
        { error: 'Pedido de upload inválido. Recarrega a página e tenta de novo.' },
        { status: 400 }
      );
    }

    console.error('[API kyc/upload] Erro no handleUpload:', error);
    return NextResponse.json(
      { error: 'Não foi possível preparar o envio do documento. Tenta novamente.' },
      { status: 503 }
    );
  }
}
