import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { isProductType, type Product } from '@/lib/products-data';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Carrega um produto pelo id (ou null). */
async function loadProduct(id: number): Promise<Product | null> {
  const rows = (await sql`
    SELECT id, name, description, price_kz, type, icon, gradient, image_url,
           featured::boolean, rating::float8, stock, user_id
    FROM products
    WHERE id = ${id}
    LIMIT 1
  `) as unknown as Product[];
  return rows[0] ?? null;
}

/**
 * GET /api/products/[id] — detalhe de um produto (com info do vendedor).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
             p.featured::boolean, p.rating::float8, p.stock, p.user_id,
             u.name AS seller_name, u.role AS seller_role
      FROM products p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ${id}
      LIMIT 1
    `) as unknown as Product[];

    if (!rows[0]) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ product: rows[0] });
  } catch (error) {
    console.error('[API products/[id]] Erro no GET:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar o produto agora.' },
      { status: 503 }
    );
  }
}

/**
 * PUT /api/products/[id] — edita um produto (apenas o dono).
 * Corpo: { name?, description?, price?, type?, image_url? }
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  let body: {
    name?: string;
    description?: string;
    price?: number | string;
    price_kz?: number | string;
    type?: string;
    image_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  try {
    const product = await loadProduct(id);
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    if (product.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Só podes editar os teus próprios produtos.' },
        { status: 403 }
      );
    }

    const name = body.name?.trim() ?? product.name;
    const description = body.description?.trim() ?? product.description;
    const rawPrice = body.price ?? body.price_kz ?? product.price_kz;
    const priceKz = Math.round(Number(rawPrice));
    const type = body.type?.trim() ?? product.type;
    const imageUrl =
      body.image_url !== undefined ? body.image_url.trim() || null : product.image_url;

    if (name.length < 3) {
      return NextResponse.json(
        { error: 'O nome deve ter pelo menos 3 letras.' },
        { status: 400 }
      );
    }
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'A descrição deve ter pelo menos 10 caracteres.' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(priceKz) || priceKz <= 0) {
      return NextResponse.json(
        { error: 'Preço inválido — indica um valor em Kwanzas maior que zero.' },
        { status: 400 }
      );
    }
    if (!isProductType(type)) {
      return NextResponse.json({ error: 'Tipo de produto inválido.' }, { status: 400 });
    }
    if (imageUrl && !/^https?:\/\/.+\..+/.test(imageUrl)) {
      return NextResponse.json(
        { error: 'O link da imagem deve começar por https:// e ser um endereço válido.' },
        { status: 400 }
      );
    }

    const updated = (await sql`
      UPDATE products
      SET name = ${name}, description = ${description}, price_kz = ${priceKz},
          type = ${type}, image_url = ${imageUrl}
      WHERE id = ${id}
      RETURNING id, name, description, price_kz, type, icon, gradient, image_url,
                featured::boolean, rating::float8, stock, user_id
    `) as unknown as Product[];

    return NextResponse.json({ product: updated[0] });
  } catch (error) {
    console.error('[API products/[id]] Erro no PUT:', error);
    return NextResponse.json(
      { error: 'Não foi possível guardar as alterações agora.' },
      { status: 503 }
    );
  }
}

/**
 * DELETE /api/products/[id] — elimina um produto (apenas o dono).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  try {
    const product = await loadProduct(id);
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    if (product.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Só podes eliminar os teus próprios produtos.' },
        { status: 403 }
      );
    }

    await sql`DELETE FROM products WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API products/[id]] Erro no DELETE:', error);
    return NextResponse.json(
      { error: 'Não foi possível eliminar o produto agora.' },
      { status: 503 }
    );
  }
}
