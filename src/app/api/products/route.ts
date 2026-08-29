import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { isProductType, type Product } from '@/lib/products-data';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import {
  sanitizeMultiline,
  sanitizeText,
  isSafeHttpUrl,
  clientKey,
  rateLimit,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

/** Angola continental — limites geográficos para validação do mapa. */
const ANGOLA_LAT = [-18.5, -4.5] as const;
const ANGOLA_LNG = [11.0, 25.0] as const;

/** Valida coordenada opcional (null quando ausente/inválida). */
function parseCoord(value: unknown, range: readonly [number, number]): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < range[0] || num > range[1]) return null;
  return Math.round(num * 1e6) / 1e6; // 6 casas decimais (~11 cm)
}

interface ProductInput {
  name?: string;
  description?: string;
  price?: number | string;
  price_kz?: number | string;
  type?: string;
  image_url?: string;
  service_lat?: number | string | null;
  service_lng?: number | string | null;
  /** URL do PDF do infoproduto (devolvido por /api/products/upload). */
  file_url?: string;
}

/**
 * GET /api/products
 * Parâmetros opcionais: ?type=infoproduto|produto_fisico|servico_domicilio|servico_remoto
 *                       ?q=texto  ?featured=1  ?hot=1  ?meu=1 (com Bearer token)
 * ?meu=1 devolve apenas os produtos do vendedor autenticado.
 * Fase 4: catálogo REAL — se o Neon estiver inacessível devolve vazio
 * (nunca produtos de exemplo).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const q = searchParams.get('q')?.trim();
  const featured = searchParams.get('featured');
  const hot = searchParams.get('hot') === '1';
  const mine = searchParams.get('meu') === '1';

  // Catálogo do vendedor autenticado (perfil → "Os meus produtos")
  if (mine) {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Sessão inválida ou expirada. Entra novamente.' },
        { status: 401 }
      );
    }
    try {
      const rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, p.stock, p.user_id, p.file_url,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ${user.id}
        ORDER BY p.created_at DESC, p.id DESC
      `) as unknown as Product[];
      return NextResponse.json({ products: rows, source: 'neon' });
    } catch (error) {
      console.error('[API /api/products] Erro (meu=1):', error);
      return NextResponse.json({ products: [], source: 'neon' });
    }
  }

  try {
    let rows: Product[];

    if (type && isProductType(type)) {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.type = ${type}
        ORDER BY p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (hot) {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.is_hot = TRUE
        ORDER BY p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (q) {
      const like = `%${q}%`;
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.name ILIKE ${like} OR p.description ILIKE ${like}
        ORDER BY p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (featured === '1') {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.featured = TRUE
        ORDER BY p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id,
               u.name AS seller_name, u.role AS seller_role
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    }

    return NextResponse.json({ products: rows, source: 'neon' });
  } catch (error) {
    console.error('[API /api/products] Erro no Neon:', error);

    // BD indisponível — catálogo REAL: devolvemos vazio em vez de dados
    // de exemplo, para nunca anunciar produtos que não existem.
    return NextResponse.json(
      { products: [], source: 'fallback' },
      { status: 200 }
    );
  }
}

/**
 * POST /api/products — publica um produto/serviço (apenas vendedores)
 * Header: Authorization: Bearer <token>
 * Corpo: { name, description, price (Kz), type, image_url? }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json(
      { error: 'Precisas de entrar para publicar. Sessão inválida ou expirada.' },
      { status: 401 }
    );
  }
  if (!isSellerRole(user.role)) {
    return NextResponse.json(
      { error: 'Apenas vendedores (criador, prestador ao domicílio ou freelancer remoto) podem publicar.' },
      { status: 403 }
    );
  }

  // 🔒 KYC (Fase 6, ponto 12): verificação de identidade obrigatória para
  // novos vendedores — o BI é obrigatório para publicar; o NIF é opcional.
  const kycRows = (await sql`
    SELECT bi_number FROM users WHERE id = ${user.id} LIMIT 1
  `) as unknown as { bi_number: string | null }[];
  if (!kycRows[0]?.bi_number) {
    return NextResponse.json(
      {
        error:
          'Verificação de identidade necessária: confirma o teu BI (bilhete de identidade) no teu perfil antes de publicar.',
        code: 'KYC_REQUIRED',
      },
      { status: 403 }
    );
  }

  if (!rateLimit(clientKey(request, 'products-post'), 15, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas publicações seguidas. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: ProductInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const name = sanitizeText(body.name, 80);
  const description = sanitizeMultiline(body.description, 2000);
  const rawPrice = body.price ?? body.price_kz;
  const priceKz = Math.round(Number(rawPrice));
  const type = body.type?.trim() ?? '';
  const imageUrl = body.image_url?.trim() || null;
  const serviceLat = parseCoord(body.service_lat, ANGOLA_LAT);
  const serviceLng = parseCoord(body.service_lng, ANGOLA_LNG);

  /* PDF do infoproduto (Fase 5): URL do Vercel Blob deste vendedor */
  let fileUrl: string | null = null;
  if (typeof body.file_url === 'string' && body.file_url.trim().length > 0) {
    const candidate = body.file_url.trim();
    if (!isSafeHttpUrl(candidate)) {
      return NextResponse.json(
        { error: 'O link do ficheiro PDF deve começar por https://.' },
        { status: 400 }
      );
    }
    if (!candidate.includes(`/ebooks/${user.id}/`)) {
      return NextResponse.json(
        { error: 'PDF inválido — envia o ficheiro primeiro em /api/products/upload.' },
        { status: 400 }
      );
    }
    fileUrl = candidate;
  }
  if (fileUrl && type !== 'infoproduto') {
    return NextResponse.json(
      { error: 'Só os infoprodutos podem ter PDF anexado.' },
      { status: 400 }
    );
  }

  if (name.length < 3) {
    return NextResponse.json(
      { error: 'O nome deve ter pelo menos 3 letras.' },
      { status: 400 }
    );
  }
  if (description.length < 10) {
    return NextResponse.json(
      { error: 'Escreve uma descrição de pelo menos 10 caracteres para atrair clientes.' },
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
    return NextResponse.json(
      { error: 'Tipo inválido — escolhe entre infoproduto, produto_fisico, servico_domicilio ou servico_remoto.' },
      { status: 400 }
    );
  }
  if (imageUrl && !isSafeHttpUrl(imageUrl)) {
    return NextResponse.json(
      { error: 'O link da imagem deve começar por https:// e ser um endereço válido.' },
      { status: 400 }
    );
  }
  if (type === 'servico_domicilio' && (serviceLat === null || serviceLng === null)) {
    return NextResponse.json(
      { error: 'Escolhe no mapa o ponto de atendimento do serviço ao domicílio.' },
      { status: 400 }
    );
  }

  try {
    const inserted = (await sql`
      INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock, service_lat, service_lng, file_url)
      VALUES (
        ${name}, ${description}, ${priceKz}, ${type},
        ${defaultIconFor(type)}, ${defaultGradientFor(type)},
        ${imageUrl}, ${user.id}, FALSE, 4.5,
        ${type === 'produto_fisico' ? 1 : -1},
        ${type === 'servico_domicilio' ? serviceLat : null},
        ${type === 'servico_domicilio' ? serviceLng : null},
        ${type === 'infoproduto' ? fileUrl : null}
      )
      RETURNING id, name, description, price_kz, type, icon, gradient, image_url,
                featured::boolean, rating::float8, stock, user_id, service_lat, service_lng, file_url
    `) as unknown as Product[];

    return NextResponse.json({ product: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API /api/products] Erro ao inserir:', error);
    return NextResponse.json(
      { error: 'Não foi possível publicar agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}

/* Gradiente/ícone por defeito consoante o tipo (mesmo estilo do catálogo) */
function defaultIconFor(type: string): string {
  switch (type) {
    case 'infoproduto':
      return 'graduation-cap';
    case 'produto_fisico':
      return 'package';
    case 'servico_domicilio':
      return 'home';
    default:
      return 'globe';
  }
}

function defaultGradientFor(type: string): string {
  switch (type) {
    case 'infoproduto':
      return 'from-emerald-500 to-teal-600';
    case 'produto_fisico':
      return 'from-blue-600 to-cyan-500';
    case 'servico_domicilio':
      return 'from-orange-500 to-amber-500';
    default:
      return 'from-violet-600 to-purple-500';
  }
}
