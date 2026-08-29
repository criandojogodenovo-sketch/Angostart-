import { NextRequest, NextResponse } from 'next/server';
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
 * Devolve o ficheiro com `Content-Disposition: attachment` para que o
 * browser faça o download em vez de abrir no separador.
 */
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

    // Busca o PDF (URL opaco do Vercel Blob)
    const fileRes = await fetch(product.file_url);
    if (!fileRes.ok) {
      console.error('[API download] Blob devolveu', fileRes.status);
      return NextResponse.json({ error: 'Ficheiro indisponível no momento.' }, { status: 502 });
    }

    const buffer = await fileRes.arrayBuffer();
    const safeName = `${product.name.replace(/[^a-zA-Z0-9._ -]+/g, '').trim() || 'infoproduto'}.pdf`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[API download] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível descarregar agora.' }, { status: 503 });
  }
}
