import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireRole, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/upload/image — emissão de token para CLIENT-SIDE UPLOAD
 * de imagens (fotos de produtos, logo/banner de loja, foto de perfil).
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🚀 UPLOAD VIA CLIENTE (contorna o limite de 4.5 MB da Vercel):
 *
 * O browser envia o ficheiro DIRETAMENTE para o Vercel Blob via URL
 * pré-assinado (upload() de @vercel/blob/client) — o corpo do ficheiro
 * NUNCA passa pela função serverless. A rota apenas:
 *   1. Autentica o utilizador (Bearer JWT).
 *   2. Emite um token de curta duração com namespace + limites fixados
 *      server-side (o cliente não decide tamanhos nem tipos).
 *   3. `onUploadCompleted` recebe a confirmação assíncrona da Vercel.
 * ═══════════════════════════════════════════════════════════════════
 *
 * ⚠️ O store Vercel Blob desta app é **PRIVADO** — as imagens ficam no
 * namespace `produtos/` (catálogo, logo/banner) ou `perfil/` (avatares),
 * servidas publicamente por GET /api/media/[...path] (stream server-side
 * com cache imutável). PDFs e documentos sensíveis têm rotas próprias.
 *
 * 🔒 SEGURANÇA:
 * - Qualquer utilizador autenticado (cliente incluído — foto de perfil).
 * - Namespace obrigatório: `produtos/<id>/…` ou `perfil/<id>/…` do PRÓPRIO
 *   utilizador — não é possível escrever no namespace de outro.
 * - Tipos permitidos fixados server-side (jpeg/png/webp), máx. 5 MB.
 * - Rate limit: 30 tokens / 10 min por IP.
 *
 * Resposta: JSON do handleUpload com { type: 'presigned-url'|..., url } —
 * o cliente usa `upload()` de @vercel/blob/client para concluir.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** Namespaces permitidos: produtos/ (vendedor) e perfil/ (avatar). */
const ALLOWED_PREFIXES = ['produtos/', 'perfil/'];

export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 30 tokens / 10 minutos por IP (upload real não passa por aqui)
  if (!rateLimit(clientKey(request, 'image-upload-token'), 30, 10 * 60_000)) {
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
          'Armazenamento de imagens ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body: request.body as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 1. Namespace obrigatório do próprio utilizador
        const ownedPrefixes = ALLOWED_PREFIXES.map(
          (ns) => `${ns}${auth.user.id}/`
        );
        const isOwned = ownedPrefixes.some((prefix) =>
          pathname.startsWith(prefix)
        );
        if (!isOwned) {
          throw new Error('PATH_FORBIDDEN');
        }

        // 2. Extensão válida
        const extension = (pathname.split('.').pop() || '').toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) {
          throw new Error('EXTENSION_FORBIDDEN');
        }

        return {
          allowedContentTypes: [...IMAGE_MIME_TYPES],
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          addRandomSuffix: true,
          cacheControlMaxAge: 31536000, // 1 ano — conteúdo imutável
          tokenPayload: JSON.stringify({ userId: auth.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Confirmação assíncrona da Vercel (fire-and-forget):
        // auditamos o upload concluído. O URL na base de dados continua a
        // ser guardado pelo cliente ao publicar o produto/perfil (o produto
        // ainda não existe no momento do upload).
        console.log(
          '[API upload/image] Upload concluído:',
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
    // Erros de corpo inválido do handleUpload (body parser)
    if (/body|payload|invalid/i.test(message)) {
      return NextResponse.json(
        { error: 'Pedido de upload inválido. Recarrega a página e tenta de novo.' },
        { status: 400 }
      );
    }

    console.error('[API upload/image] Erro no handleUpload:', error);
    return NextResponse.json(
      { error: 'Não foi possível preparar o envio da foto. Tenta novamente.' },
      { status: 503 }
    );
  }
}
