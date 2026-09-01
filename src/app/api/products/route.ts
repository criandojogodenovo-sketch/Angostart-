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
import { isInternalMediaUrl } from '@/lib/payments-manual';
import { keywordsReady, isUndefinedColumnError, markKeywordsUnavailable } from '@/lib/keywords-db';
import { parseKeywords, isGenericKeyword, MAX_KEYWORDS } from '@/lib/keywords';

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
  /** Fase 15: palavras-chave (string separada por vírgulas ou array). */
  keywords?: unknown;
}

/**
 * Valida e normaliza as keywords do corpo. Devolve o array pronto (ou
 * `null` quando o campo não foi enviado) — ou um erro 400 para mostrar ao
 * vendedor. Duplicados são removidos silenciosamente.
 */
function parseBodyKeywords(
  input: unknown
): { keywords: string[] | null; error?: string } {
  if (input === undefined || input === null) return { keywords: null };
  const parsed = parseKeywords(input);
  if (parsed.invalid.length > 0) {
    return {
      keywords: null,
      error: `Palavras-chave inválidas: ${parsed.invalid
        .slice(0, 5)
        .join(', ')} — usa apenas letras, números e hífens (entre 2 e 30 caracteres).`,
    };
  }
  if (parsed.truncated) {
    return {
      keywords: null,
      error: `Máximo de ${MAX_KEYWORDS} palavras-chave — remove as que sobrarem.`,
    };
  }
  return { keywords: parsed.keywords };
}

/**
 * GET /api/products
 * Parâmetros opcionais: ?type=infoproduto|produto_fisico|servico_domicilio|servico_remoto
 *                       ?q=texto  ?featured=1  ?hot=1  ?meu=1 (com Bearer token)
 * ?meu=1 devolve apenas os produtos do vendedor autenticado.
 * Fase 4: catálogo REAL — se o Neon estiver inacessível devolve vazio
 * (nunca produtos de exemplo).
 *
 * Fase 15: com a migração de keywords aplicada (keywordsReady()), a busca
 * ?q= também percorre products.keywords e os produtos cujas keywords
 * correspondem à pesquisa ficam NO TOPO (ranking boost) — exceto quando a
 * pesquisa é uma palavra genérica ("barato", "grátis"…), que nunca recebe
 * prioridade (anti-manipulação).
 */
export async function GET(request: NextRequest) {
  /* Leitura pública pesada (ILIKE) — throttle defensivo por IP. */
  if (!rateLimit(clientKey(request, 'products-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }
  try {
    return await handleGetProducts(request, true);
  } catch (error) {
    /* Rede de segurança: coluna keywords em falta (deploy antes da
       migração) → desativa keywords neste processo e repete SEM elas —
       o catálogo continua a funcionar normalmente. */
    if (isUndefinedColumnError(error)) {
      markKeywordsUnavailable();
      try {
        return await handleGetProducts(request, false);
      } catch (retryError) {
        console.error('[API /api/products] Erro no retry sem keywords:', retryError);
        return NextResponse.json({ products: [], source: 'fallback' }, { status: 200 });
      }
    }
    throw error;
  }
}

async function handleGetProducts(
  request: NextRequest,
  withKeywords: boolean
): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const q = searchParams.get('q')?.trim();
  const featured = searchParams.get('featured');
  const hot = searchParams.get('hot') === '1';
  const mine = searchParams.get('meu') === '1';

  const kwReady = withKeywords && (await keywordsReady());
  /* Fragmento de colunas extra (vazio quando a migração ainda não correu). */
  const kwSelect = kwReady ? sql`, p.keywords` : sql``;

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
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, p.stock, p.user_id, p.file_url${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
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

    /* Fase 11: store_slug + seller_username permitem o botão "Ver loja" /
       "Ver vendedor" no cartão (loja em primeiro lugar; sem loja → portfólio). */
    if (type && isProductType(type)) {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
        WHERE p.type = ${type}
        ORDER BY p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (hot) {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
        WHERE p.is_hot = TRUE
        ORDER BY p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (q) {
      const like = `%${q}%`;
      /* Fase 15: busca também nas keywords + prioridade a quem as tem.
         Palavras genéricas nunca recebem o boost (anti-manipulação). */
      const kwSearch = kwReady
        ? sql`OR EXISTS (SELECT 1 FROM unnest(p.keywords) k WHERE k ILIKE ${like})`
        : sql``;
      const kwBoost =
        kwReady && !isGenericKeyword(q)
          ? sql`(CASE WHEN EXISTS (SELECT 1 FROM unnest(p.keywords) k WHERE k ILIKE ${like}) THEN 1 ELSE 0 END) DESC, `
          : sql``;
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
        WHERE p.name ILIKE ${like} OR p.description ILIKE ${like} ${kwSearch}
        ORDER BY ${kwBoost}p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else if (featured === '1') {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
        WHERE p.featured = TRUE
        ORDER BY p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    } else {
      rows = (await sql`
        SELECT p.id, p.name, p.description, p.price_kz, p.type, p.icon, p.gradient, p.image_url,
               p.featured::boolean, p.is_hot::boolean, p.rating::float8, (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.user_id${kwSelect},
               u.name AS seller_name, u.role AS seller_role, u.is_verified_bi::boolean AS seller_verified,
               u.username AS seller_username, s.slug AS store_slug
        FROM products p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores s ON s.owner_id = p.user_id
        ORDER BY p.is_hot DESC, p.featured DESC, p.created_at DESC, p.id DESC
      `) as unknown as Product[];
    }

    return NextResponse.json({ products: rows, source: 'neon' });
  } catch (error) {
    console.error('[API /api/products] Erro no Neon:', error);
    throw error;
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

  // 🔒 KYC (Fase 12 + Fase 13): vendedor pode vender normalmente enquanto a
  // verificação está pendente ou nem foi submetida (dentro da carência de
  // 30 dias). Publicação BLOQUEADA quando:
  //  - 'rejected' → admin recusou o documento (até nova submissão);
  //  - 'overdue'  → (Fase 13) prazo de 30 dias expirou sem documento.
  // 'verified' dá o selo azul.
  const kycRows = (await sql`
    SELECT kyc_status FROM users WHERE id = ${user.id} LIMIT 1
  `) as unknown as { kyc_status: string | null }[];
  const kycStatus = kycRows[0]?.kyc_status ?? 'not_submitted';
  if (kycStatus === 'rejected') {
    return NextResponse.json(
      {
        error:
          'A tua verificação de identidade foi recusada pela equipa AngoStart — envia um novo documento no Painel de vendas (Verificação de Identidade) para voltar a publicar.',
        code: 'KYC_REJECTED',
      },
      { status: 403 }
    );
  }
  if (kycStatus === 'overdue') {
    return NextResponse.json(
      {
        error:
          'O prazo de 30 dias para verificar a tua identidade expirou — envia a foto do documento no Painel de vendas (Verificação de Identidade) para voltar a publicar. As tuas vendas existentes continuam normais.',
        code: 'KYC_OVERDUE',
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
  /* Imagem: link https externo OU URL interno do upload (/api/media/produtos/…). */
  const imageUrlValid =
    !imageUrl || isSafeHttpUrl(imageUrl) || isInternalMediaUrl(imageUrl);
  if (!imageUrlValid) {
    return NextResponse.json(
      { error: 'O link da imagem deve começar por https:// ou ser uma foto enviada para o Blob.' },
      { status: 400 }
    );
  }
  if (type === 'servico_domicilio' && (serviceLat === null || serviceLng === null)) {
    return NextResponse.json(
      { error: 'Escolhe no mapa o ponto de atendimento do serviço ao domicílio.' },
      { status: 400 }
    );
  }

  /* Fase 15: keywords opcionais (até 10; validação anti-spam). */
  const kwParsed = parseBodyKeywords(body.keywords);
  if (kwParsed.error) {
    return NextResponse.json({ error: kwParsed.error }, { status: 400 });
  }
  const keywords = kwParsed.keywords ?? [];

  try {
    try {
      const inserted = await insertProduct({
        name, description, priceKz, type, imageUrl, user, serviceLat, serviceLng,
        fileUrl, keywords,
        withKeywords: await keywordsReady(),
      });

    // Gamificação (Fase 7): selo «Criador de Infoprodutos» a partir de 5
    if (inserted[0]?.user_id) {
      try {
        const { evaluateBadges } = await import('@/lib/gamification-server');
        evaluateBadges(inserted[0].user_id).catch(() => {});
      } catch {
        /* gamificação opcional */
      }
    }

    // Fase 9 («Seguir»): notifica seguidores da loja da nova publicação
    if (inserted[0]?.id) {
      try {
        const { notifyFollowersNewProduct } = await import('@/lib/stores');
        notifyFollowersNewProduct(user.id, inserted[0].name, inserted[0].id).catch(() => {});
      } catch {
        /* notificação opcional */
      }
    }

    return NextResponse.json({ product: inserted[0] }, { status: 201 });
    } catch (error) {
      /* Deploy antes da migração → repete uma vez SEM as colunas novas. */
      if (isUndefinedColumnError(error)) {
        markKeywordsUnavailable();
        const inserted = await insertProduct({
          name, description, priceKz, type, imageUrl, user, serviceLat, serviceLng,
          fileUrl, keywords,
          withKeywords: false,
        });
        return NextResponse.json({ product: inserted[0] }, { status: 201 });
      }
      throw error;
    }
  } catch (error) {
    console.error('[API /api/products] Erro ao inserir:', error);
    return NextResponse.json(
      { error: 'Não foi possível publicar agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}

interface InsertProductArgs {
  name: string;
  description: string;
  priceKz: number;
  type: string;
  imageUrl: string | null;
  user: { id: number };
  serviceLat: number | null;
  serviceLng: number | null;
  fileUrl: string | null;
  keywords: string[];
  withKeywords: boolean;
}

/** INSERT de produto — as colunas de keywords entram só quando a migração já correu. */
async function insertProduct(args: InsertProductArgs): Promise<Product[]> {
  const { name, description, priceKz, type, imageUrl, user, serviceLat, serviceLng, fileUrl, keywords } = args;
  const kwReady = args.withKeywords;
  const kwCols = kwReady ? sql`, keywords` : sql``;
  /* created_at tem DEFAULT now() — NÃO injetar NOW() aqui: kwCols declara
     apenas 1 coluna e valores a mais quebram o INSERT (42601, bug de
     produção detetado na auditoria). */
  const kwVals = kwReady ? sql`, ${keywords}::text[]` : sql``;
  const kwReturn = kwReady ? sql`, keywords` : sql``;

  /* Fase 11: rating nasce NULL — "Sem avaliações" até haver reviews
     reais (o antigo 4.5 por omissão fazia novos produtos parecerem
     avaliados — bug corrigido). */
  return (await sql`
    INSERT INTO products (name, description, price_kz, type, icon, gradient, image_url, user_id, featured, rating, stock, service_lat, service_lng, file_url${kwCols})
    VALUES (
      ${name}, ${description}, ${priceKz}, ${type},
      ${defaultIconFor(type)}, ${defaultGradientFor(type)},
      ${imageUrl}, ${user.id}, FALSE, NULL,
      ${type === 'produto_fisico' ? 1 : -1},
      ${type === 'servico_domicilio' ? serviceLat : null},
      ${type === 'servico_domicilio' ? serviceLng : null},
      ${fileUrl}${kwVals}
    )
    RETURNING id, name, description, price_kz, type, icon, gradient, image_url,
              featured::boolean, rating::float8, stock, user_id, service_lat, service_lng, file_url${kwReturn}
  `) as unknown as Product[];
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
      return 'from-blue-600 to-teal-600';
    case 'produto_fisico':
      return 'from-blue-600 to-cyan-500';
    case 'servico_domicilio':
      return 'from-teal-500 to-blue-600';
    default:
      return 'from-violet-600 to-purple-500';
  }
}
