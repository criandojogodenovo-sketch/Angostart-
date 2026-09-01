import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireRole, clientKey, rateLimit } from '@/lib/security';
import { isSellerRole } from '@/lib/roles';

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
 * - Namespace obrigatório, do PRÓPRIO utilizador e por papel:
 *   clientes → `perfil/<id>/…`; vendedores → `produtos/<id>/…` e
 *   `perfil/<id>/…`. Não é possível escrever no namespace de outro.
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

  /* ── Pré-validação do pedido de token (ANTES de depender do Blob) ──

     ⚠️ ARQUITETURA DO UPLOAD CLIENT-SIDE: o ficheiro NUNCA passa por
     esta rota. O SDK (@vercel/blob/client) envia apenas um corpo JSON
     { type: 'blob.generate-client-token' | 'blob.generate-presigned-url',
       payload: { pathname, clientPayload, multipart } } e depois faz
     PUT do ficheiro DIRETAMENTE ao URL pré-assinado do Blob Store.
     (Um POST multipart com o ficheiro aqui quebraria TODOS os uploads
     legítimos — pedido de token é JSON, não form-data.)

     Por isso a validação própria desta rota é sobre o PEDIDO:
     - corpo tem de ser um evento JSON conhecido do SDK (lixo → 400);
     - namespace tem de pertencer ao PRÓPRIO utilizador (→ 400);
     - extensão tem de ser jpg/jpeg/png/webp (→ 400).
     Falha rápido com 400 mesmo sem BLOB_READ_WRITE_TOKEN.

     🛡️ MIME/magic bytes — onde é que a enforce acontece de verdade:
     1. `allowedContentTypes` + `maximumSizeInBytes` são FIXADOS
        server-side no token pré-assinado (onBeforeGenerateToken) — o
        cliente não os pode alterar; o Blob Store rejeita o PUT se o
        Content-Type declarado não for jpeg/png/webp ou se exceder 5 MB.
     2. O store é PRIVADO — nenhum byte é servido por URL direto.
     3. GET /api/media/[...path] serve apenas paths de imagem com regex
        estrita, Content-Type fixo pela extensão + nosniff — um
        executável disfarçado de .png nunca executa (nem nasce XSS).
     Como o ficheiro não transita por esta função, não há magic bytes
     para inspecionar aqui — validar bytes seria exigir multipart e
     regressar ao limite de 4.5 MB de corpo serverless. */
  const peek: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const peekType =
    typeof peek === 'object' && peek !== null
      ? (peek as { type?: unknown }).type
      : undefined;
  const peekPayload =
    typeof peek === 'object' && peek !== null
      ? (peek as { payload?: unknown }).payload
      : undefined;

  if (
    typeof peekType !== 'string' ||
    !['blob.generate-client-token', 'blob.generate-presigned-url', 'blob.upload-completed'].includes(
      peekType
    ) ||
    typeof peekPayload !== 'object' ||
    peekPayload === null
  ) {
    return NextResponse.json(
      { error: 'Pedido de upload inválido — recarrega a página e tenta de novo.' },
      { status: 400 }
    );
  }

  // O webhook 'blob.upload-completed' (Vercel → callback assinado) passa
  // direto para o handleUpload, que valida a assinatura x-vercel-signature.
  if (peekType !== 'blob.upload-completed') {
    const peekPathname = (peekPayload as { pathname?: unknown }).pathname;
    if (typeof peekPathname !== 'string' || peekPathname.length === 0) {
      return NextResponse.json(
        { error: 'Pedido de upload inválido — pathname em falta.' },
        { status: 400 }
      );
    }
    // Namespaces por papel: clientes só podem FOTO DE PERFIL (perfil/);
    // vendedores também o catálogo (produtos/). Admin não publica produtos.
    const allowedNamespaces = isSellerRole(auth.user.role)
      ? ALLOWED_PREFIXES
      : (['perfil/'] as const);
    const ownedPrefixes = allowedNamespaces.map((ns) => `${ns}${auth.user.id}/`);
    const matchedPrefix = ownedPrefixes.find((prefix) =>
      peekPathname.startsWith(prefix)
    );
    if (!matchedPrefix) {
      return NextResponse.json(
        { error: 'Namespace de upload inválido para a tua conta.' },
        { status: 400 }
      );
    }
    // Nome de ficheiro estrito: um único segmento, sem traversal e sem
    // subdirectórios (o Blob trata o pathname como chave plana, mas a
    // defesa em profundidade mantém o namespace normalizado).
    const fileName = peekPathname.slice(matchedPrefix.length);
    if (fileName.length === 0 || fileName.includes('/') || fileName.includes('..')) {
      return NextResponse.json(
        { error: 'Pathname de upload inválido.' },
        { status: 400 }
      );
    }
    const peekExt = (fileName.split('.').pop() || '').toLowerCase();
    if (!IMAGE_EXTENSIONS.has(peekExt)) {
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
          'Armazenamento de imagens ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    // ⚠️ O SDK espera o EVENTO JSON PARSED (body.type é lido diretamente).
    // Passar request.body (ReadableStream) → "Invalid event type" → 400
    // em TODOS os uploads. `peek` é o clone já parsed da pré-validação.
    const jsonResponse = await handleUpload({
      body: peek as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 1. Namespace obrigatório do próprio utilizador (por papel:
        //    clientes → perfil/; vendedores → produtos/ + perfil/)
        const allowedNamespaces = isSellerRole(auth.user.role)
          ? ALLOWED_PREFIXES
          : (['perfil/'] as const);
        const ownedPrefixes = allowedNamespaces.map(
          (ns) => `${ns}${auth.user.id}/`
        );
        const matchedPrefix = ownedPrefixes.find((prefix) =>
          pathname.startsWith(prefix)
        );
        if (!matchedPrefix) {
          throw new Error('PATH_FORBIDDEN');
        }

        // 2. Nome de ficheiro estrito (sem traversal, sem subdirectórios)
        const fileName = pathname.slice(matchedPrefix.length);
        if (fileName.length === 0 || fileName.includes('/') || fileName.includes('..')) {
          throw new Error('PATH_FORBIDDEN');
        }

        // 3. Extensão válida
        const extension = (fileName.split('.').pop() || '').toLowerCase();
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
