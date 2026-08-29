import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { isProductType, type Product } from '@/lib/products-data';
import { getAuthUser, isAdminRole } from '@/lib/auth';
import { sanitizeMultiline, sanitizeText, isSafeHttpUrl } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** Angola continental — limites geográficos para validação do mapa. */
const ANGOLA_LAT = [-18.5, -4.5] as const;
const ANGOLA_LNG = [11.0, 25.0] as const;

function parseCoord(value: unknown, range: readonly [number, number]): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < range[0] || num > range[1]) return null;
  return Math.round(num * 1e6) / 1e6;
}

type RouteContext = { params: Promise<{ id: string }> };

/** Carrega um produto pelo id (ou null). */
async function loadProduct(id: number): Promise<Product | null> {
  const rows = (await sql`
    SELECT id, name, description, price_kz, type, icon, gradient, image_url,
           featured::boolean, is_hot::boolean, rating::float8, stock, user_id, file_url
    FROM products
    WHERE id = ${id}
    LIMIT 1
  `) as unknown as Product[];
  return rows[0] ?? null;
}

/**
 * GET /api/products/[id] — detalhe de um produto (com vendedor, mapa e
 * média de avaliações — página /produtos/[id]).
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
             p.featured::boolean, p.is_hot::boolean, p.rating::float8, p.stock, p.user_id,
             p.service_lat, p.service_lng, p.file_url,
             u.name AS seller_name, u.role AS seller_role, u.username AS seller_username,
             u.cidade AS seller_cidade, u.especialidade AS seller_especialidade,
             u.telefone AS seller_telefone, u.portfolio_image AS seller_portfolio_image
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
    service_lat?: number | string | null;
    service_lng?: number | string | null;
    file_url?: string | null;
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

    const name = sanitizeText(body.name, 80) || product.name;
    const description = sanitizeMultiline(body.description, 2000) || product.description;
    const rawPrice = body.price ?? body.price_kz ?? product.price_kz;
    const priceKz = Math.round(Number(rawPrice));
    const type = body.type?.trim() ?? product.type;
    const imageUrl =
      body.image_url !== undefined ? body.image_url.trim() || null : product.image_url;
    const nextType = type;
    const serviceLat =
      body.service_lat !== undefined || body.service_lng !== undefined
        ? parseCoord(body.service_lat, ANGOLA_LAT)
        : (product as unknown as { service_lat?: number | null }).service_lat ?? null;
    const serviceLng =
      body.service_lat !== undefined || body.service_lng !== undefined
        ? parseCoord(body.service_lng, ANGOLA_LNG)
        : (product as unknown as { service_lng?: number | null }).service_lng ?? null;

    /* PDF do infoproduto (Fase 5) — mantém o atual se não vier novo */
    let fileUrl: string | null =
      (product as unknown as { file_url?: string | null }).file_url ?? null;
    if (body.file_url !== undefined) {
      const candidate = typeof body.file_url === 'string' ? body.file_url.trim() : '';
      if (candidate.length === 0) {
        fileUrl = null;
      } else if (!isSafeHttpUrl(candidate)) {
        return NextResponse.json(
          { error: 'O link do ficheiro PDF deve começar por https://.' },
          { status: 400 }
        );
      } else if (!candidate.includes(`/ebooks/${user.id}/`)) {
        return NextResponse.json(
          { error: 'PDF inválido — envia o ficheiro primeiro em /api/products/upload.' },
          { status: 400 }
        );
      } else {
        fileUrl = candidate;
      }
    }
    if (nextType !== 'infoproduto') fileUrl = null;

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
    if (imageUrl && !isSafeHttpUrl(imageUrl)) {
      return NextResponse.json(
        { error: 'O link da imagem deve começar por https:// e ser um endereço válido.' },
        { status: 400 }
      );
    }
    if (nextType === 'servico_domicilio' && (serviceLat === null || serviceLng === null)) {
      return NextResponse.json(
        { error: 'Escolhe no mapa o ponto de atendimento do serviço ao domicílio.' },
        { status: 400 }
      );
    }

    const updated = (await sql`
      UPDATE products
      SET name = ${name}, description = ${description}, price_kz = ${priceKz},
          type = ${type}, image_url = ${imageUrl},
          service_lat = ${nextType === 'servico_domicilio' ? serviceLat : null},
          service_lng = ${nextType === 'servico_domicilio' ? serviceLng : null},
          file_url = ${fileUrl}
      WHERE id = ${id}
      RETURNING id, name, description, price_kz, type, icon, gradient, image_url,
                featured::boolean, is_hot::boolean, rating::float8, stock, user_id, service_lat, service_lng, file_url
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
 * PATCH /api/products/[id] — alterna o badge "Em alta" 🔥
 * Corpo: { is_hot: boolean } — apenas o dono do produto.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

  let body: { is_hot?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }
  const isHot = body.is_hot === true;

  try {
    const product = await loadProduct(id);
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    if (product.user_id !== user.id && !isAdminRole(user.role)) {
      return NextResponse.json(
        { error: 'Só podes marcar os teus próprios produtos como "em alta".' },
        { status: 403 }
      );
    }

    const updated = (await sql`
      UPDATE products
      SET is_hot = ${isHot}
      WHERE id = ${id}
      RETURNING id, name, is_hot::boolean
    `) as unknown as { id: number; name: string; is_hot: boolean }[];

    return NextResponse.json({ ok: true, product: updated[0] });
  } catch (error) {
    console.error('[API products/[id]] Erro no PATCH (is_hot):', error);
    return NextResponse.json(
      { error: 'Não foi possível atualizar o badge agora.' },
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
    if (product.user_id !== user.id && !isAdminRole(user.role)) {
      return NextResponse.json(
        { error: 'Só podes eliminar os teus próprios produtos.' },
        { status: 403 }
      );
    }

    await sql`DELETE FROM reviews WHERE product_id = ${id}`;
    await sql`DELETE FROM products WHERE id = ${id}`;
    return NextResponse.json({ ok: true, deletedBy: user.role });
  } catch (error) {
    console.error('[API products/[id]] Erro no DELETE:', error);
    return NextResponse.json(
      { error: 'Não foi possível eliminar o produto agora.' },
      { status: 503 }
    );
  }
}
