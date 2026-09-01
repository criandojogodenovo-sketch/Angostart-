import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireSeller, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/products/upload — emissão de token para CLIENT-SIDE UPLOAD
 * do PDF de um infoproduto (Fase 5, corrigido com upload via cliente).
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🚀 PORQUÊ CLIENT-SIDE? O antigo fluxo (formData + put() server-side)
 * quebrava SEMPRE que o PDF excedia 4.5 MB — o limite de corpo de
 * funções serverless da Vercel. Com `handleUpload()` + `upload()`, o
 * browser envia o PDF DIRETAMENTE para o Blob: ficheiros de até 20 MB
 * (e além, via multipart automático) passam a funcionar.
 * ═══════════════════════════════════════════════════════════════════
 *
 * ⚠️ O store é PRIVATE: o `url` devolvido NÃO é acessível publicamente.
 * O download só acontece via /api/products/[id]/download, que valida a
 * compra paga e gera um URL temporário assinado (1h) ou faz stream
 * autenticado server-side.
 *
 * 🔒 SEGURANÇA:
 * - Apenas vendedores autenticados (requireSeller).
 * - Namespace obrigatório `ebooks/<id-do-utilizador>/…`.
 * - Tipos permitidos fixados server-side (application/pdf), máx. 20 MB.
 * - Rate limit: 12 tokens / 10 min por IP.
 */

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

const PDF_MIME_TYPES = [
  'application/pdf',
  'application/x-pdf',
] as const;

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 12 tokens / 10 minutos por IP
  if (!rateLimit(clientKey(request, 'pdf-upload-token'), 12, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados uploads seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          'Armazenamento de PDFs ainda não configurado. O administrador deve criar um Blob Store na Vercel e definir BLOB_READ_WRITE_TOKEN.',
      },
      { status: 503 }
    );
  }

  /* ── Parse + pré-validação do evento JSON do SDK ──

     ⚠️ O ficheiro NUNCA passa por esta rota: o browser faz PUT direto
     ao URL pré-assinado. Aqui chega apenas o evento JSON
     { type: 'blob.generate-client-token', payload: { pathname, … } }
     (ou o webhook assinado 'blob.upload-completed' da Vercel).
     O SDK (handleUpload) espera o evento JÁ PARSED — passar
     request.body (ReadableStream) fazia body.type = undefined →
     "Invalid event type" → 400 em TODOS os uploads. */
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
  // Namespace/extensão são enforceados em onBeforeGenerateToken (abaixo)
  // e o tamanho/tipo de conteúdo pelo Blob Store (maximumSizeInBytes /
  // allowedContentTypes fixados server-side no token).

  try {
    const jsonResponse = await handleUpload({
      body: peek as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Namespace obrigatório do próprio vendedor
        const ownedPrefix = `ebooks/${auth.user.id}/`;
        if (!pathname.startsWith(ownedPrefix)) {
          throw new Error('PATH_FORBIDDEN');
        }

        // Extensão .pdf obrigatória
        if (!pathname.toLowerCase().endsWith('.pdf')) {
          throw new Error('EXTENSION_FORBIDDEN');
        }

        return {
          allowedContentTypes: [...PDF_MIME_TYPES],
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: auth.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Confirmação assíncrona da Vercel — auditoria.
        // O URL é guardado em products.file_url pelo cliente ao publicar
        // (o produto ainda não existe no momento do upload).
        console.log(
          '[API products/upload] PDF concluído:',
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
        { error: 'Formato inválido — envia apenas ficheiros PDF.' },
        { status: 400 }
      );
    }
    if (/body|payload|invalid/i.test(message)) {
      return NextResponse.json(
        { error: 'Pedido de upload inválido. Recarrega a página e tenta de novo.' },
        { status: 400 }
      );
    }

    console.error('[API products/upload] Erro no handleUpload:', error);
    return NextResponse.json(
      { error: 'Não foi possível preparar o envio do PDF. Tenta novamente.' },
      { status: 503 }
    );
  }
}
