import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * GET /api/media/[...path] — serve IMAGENS DE PRODUTOS do catálogo
 * (namespace `produtos/`) a qualquer visitante.
 *
 * O store Vercel Blob é PRIVADO, por isso as fotos enviadas por
 * POST /api/upload/image (guardadas em products.image_url como
 * `/api/media/produtos/…`) são servidas por aqui, em stream server-side.
 *
 * 🔒 SEGURANÇA — superfície rigorosamente limitada:
 * - Aceita APENAS paths no formato `produtos/<userId>/<timestamp>-<nome>`
 *   (regex estrita, sem `..`, sem barras extra) — o resto → 404.
 * - NUNCA expõe `ebooks/` (PDFs de infoprodutos, acesso controlado por
 *   compra em /api/products/[id]/download) nem qualquer outro namespace.
 * - `Content-Type` restringido a imagens (defesa contra content sniffing).
 * - Cache público imutável: o pathname inclui timestamp + sufixo aleatório
 *   (conteúdo nunca muda) → browsers e CDN da Vercel cacheiam; sem custo
 *   extra de blob em visitas repetidas.
 * - Rate limit: 120 pedidos/min por IP (catálogo carrega várias fotos).
 */

/** Formatos gerados por POST /api/upload/image (produtos/ e perfil/). */
const MEDIA_PATH_RE =
  /^(?:produtos|perfil)\/\d+\/\d{13}-[A-Za-z0-9._-]{1,120}$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(request: NextRequest, context: RouteContext) {
  // 120 pedidos / minuto por IP — imagens de catálogo carregam em lote
  if (!rateLimit(clientKey(request, 'media-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const { path } = await context.params;
  const pathname = (path ?? []).join('/');

  if (!MEDIA_PATH_RE.test(pathname)) {
    // Namespace desconhecido ou path mal formado — não existe para o público
    return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      { error: 'Armazenamento não configurado.' },
      { status: 503 }
    );
  }

  try {
    // `get` aceita pathname e resolve o store a partir do token (v2.8.0)
    const result = await get(pathname, { access: 'private', token: blobToken });

    if (!result || result.statusCode !== 200) {
      console.error('[API media] Blob indisponível:', result?.statusCode);
      return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 502 });
    }

    const extension = (pathname.split('.').pop() || '').toLowerCase();

    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        // Conteúdo imutável (pathname único por upload) — cache agressivo
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // Blob apagado ou inexistente → 404 limpo (não 500)
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404/i.test(message)) {
      return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
    }
    console.error('[API media] Erro:', error);
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 502 });
  }
}
