import { NextRequest, NextResponse } from 'next/server';
import { get, issueSignedToken, presignUrl } from '@vercel/blob';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/products/[id]/download — descarrega o PDF de um infoproduto.
 *
 * 🔒 ACESSO CONTROLADO (Fase 5):
 *  - Comprador com encomenda 'pago'/'entregue' contendo este produto; ou
 *  - O próprio vendedor do produto; ou
 *  - Administradores.
 *
 * 🔐 FIX Blob privado: o store Vercel Blob é PRIVATE — o `file_url`
 * guardado na BD NÃO é acessível publicamente e NUNCA é devolvido ao
 * cliente. O acesso autorizado segue uma de duas vias:
 *
 *  1) (Primária) Gera um **URL temporário assinado** (presigned, expira em
 *     3600 s) com `issueSignedToken` + `presignUrl`, scoped ao pathname do
 *     blob e à operação `get`, e redireciona (307) o browser para ele.
 *  2) (Fallback) Se a presignagem falhar, faz **stream autenticado
 *     server-side** com `get(url, { access: 'private' })` — o conteúdo
 *     passa pelo servidor e nenhum URL do Blob é exposto.
 */

const TEMP_URL_TTL_SECONDS = 3600; // URL temporário válido 1 hora

/** Extrai o pathname do blob (ex: 'ebooks/3/1700000-guia.pdf') de um URL ou pathname. */
function blobPathnameFrom(urlOrPathname: string): string {
  try {
    const u = new URL(urlOrPathname);
    return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    // Já é um pathname puro
    return urlOrPathname.replace(/^\/+/, '');
  }
}

/** Nome de ficheiro seguro a partir do pathname do blob (fallback: nome do produto). */
function safeFileName(pathname: string, productName: string): string {
  const base = pathname.split('/').pop() || '';
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]+/g, '').trim();
  if (cleaned.toLowerCase().endsWith('.pdf')) return cleaned;
  const fromProduct = `${productName.replace(/[^a-zA-Z0-9._ -]+/g, '').trim() || 'infoproduto'}.pdf`;
  return cleaned || fromProduct;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para descarregar o teu infoproduto.' },
      { status: 401 }
    );
  }

  // 20 downloads / minuto
  if (!rateLimit(clientKey(request, 'pdf-download'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, name, file_url, user_id
      FROM products
      WHERE id = ${productId} AND file_url IS NOT NULL
      LIMIT 1
    `) as unknown as { id: number; name: string; file_url: string; user_id: number | null }[];

    const product = rows[0];
    if (!product || !product.file_url) {
      return NextResponse.json(
        { error: 'Este produto não tem ficheiro para descarregar.' },
        { status: 404 }
      );
    }

    const isSeller = product.user_id === user.id;
    const isAdmin = user.role === 'admin' || user.role === 'admin_limitado';

    let hasPurchased = false;
    if (!isSeller && !isAdmin) {
      const purchases = (await sql`
        SELECT 1 FROM orders
        WHERE user_id = ${user.id}
          AND status IN ('pago', 'entregue')
          AND items @> ${JSON.stringify([{ id: productId }])}::jsonb
        LIMIT 1
      `) as unknown as unknown[];
      hasPurchased = purchases.length > 0;
    }

    if (!isSeller && !isAdmin && !hasPurchased) {
      return NextResponse.json(
        { error: 'Só podes descarregar infoprodutos que compraste (pagamento confirmado).' },
        { status: 403 }
      );
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return NextResponse.json(
        {
          error:
            'Armazenamento de PDFs ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
        },
        { status: 503 }
      );
    }

    /* ---------- Autorizado: aceder ao blob PRIVADO ---------- */

    const pathname = blobPathnameFrom(product.file_url);
    const fileName = safeFileName(pathname, product.name);

    // `?mode=stream` — cliente pede stream direto (ex.: fallback se o follow
    // do redirect 307 falhar por CORS no browser). Nunca expõe o URL do Blob.
    const forceStream = request.nextUrl.searchParams.get('mode') === 'stream';

    // (1) Primária — URL temporário assinado, expira em TEMP_URL_TTL_SECONDS
    if (!forceStream) {
      try {
        const validUntil = Date.now() + TEMP_URL_TTL_SECONDS * 1000;

        const signed = await issueSignedToken({
          token: blobToken,
          pathname, // escopo: apenas este ficheiro
          operations: ['get'], // apenas leitura
          validUntil,
        });

        const { presignedUrl } = await presignUrl(signed, {
          operation: 'get',
          pathname,
          access: 'private',
          validUntil,
        });

        // download=1 força Content-Disposition: attachment (param não assinado, permitido pelo CDN)
        const redirectUrl = `${presignedUrl}${presignedUrl.includes('?') ? '&' : '?'}download=1`;
        return NextResponse.redirect(redirectUrl, 307);
      } catch (presignError) {
        console.error(
          '[API download] Presign falhou — fallback para stream privado:',
          presignError instanceof Error ? presignError.message : presignError
        );
      }
    }

    // (2) Fallback — stream autenticado server-side; nenhum URL do Blob é exposto
    const result = await get(product.file_url, { access: 'private', token: blobToken });

    if (!result || result.statusCode !== 200) {
      console.error('[API download] Blob não encontrado ou não modificado:', result?.statusCode);
      return NextResponse.json({ error: 'Ficheiro indisponível no momento.' }, { status: 502 });
    }

    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[API download] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível descarregar agora.' }, { status: 503 });
  }
}
