import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ username: string }> };

/**
 * GET /api/portfolio/[username] — portfólio PÚBLICO de um vendedor
 * (página /portfolio/[username]) — Mini-Loja (Fase 6, ponto 1).
 *
 * Devolve: dados de perfil, estatísticas públicas (produtos publicados,
 * clientes servidos, média de avaliações), produtos ativos e avaliações
 * recebidas. Quando ainda não há avaliações reais devolve uma
 * `rating_estimado` claramente marcada como estimada (Fase 6, ponto 6).
 *
 * 🔒 Fase 6 (ponto 2): NÃO expõe whatsapp/telefone — todo o contacto
 * passa pelo chat interno da plataforma.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'portfolio-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }
  const { username: rawUsername } = await context.params;
  const username = decodeURIComponent(rawUsername).trim().toLowerCase();

  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    return NextResponse.json({ error: 'Portfólio não encontrado.' }, { status: 404 });
  }

  try {
    const rows = (await sql`
      SELECT id, name, role, username, cidade, especialidade, bio,
             portfolio_bio, portfolio_image, portfolio_url, profile_image
      FROM users
      WHERE username = ${username}
        AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
        AND blocked = FALSE
      LIMIT 1
    `) as unknown as {
      id: number;
      name: string;
      role: Role;
      username: string;
      cidade: string | null;
      especialidade: string | null;
      bio: string | null;
      portfolio_bio: string | null;
      portfolio_image: string | null;
      portfolio_url: string | null;
      profile_image: string | null;
    }[];

    const seller = rows[0];
    if (!seller) {
      return NextResponse.json({ error: 'Portfólio não encontrado.' }, { status: 404 });
    }

    const items = (await sql`
      SELECT id, title, description, image_url, created_at
      FROM portfolio_items WHERE user_id = ${seller.id}
      ORDER BY position ASC, created_at ASC
      LIMIT 24
    `) as unknown as Record<string, unknown>[];

    const products = (await sql`
      SELECT id, name, description, price_kz, type, icon, gradient, image_url,
             rating::float8, is_hot::boolean
      FROM products WHERE user_id = ${seller.id}
      ORDER BY is_hot DESC, featured DESC, created_at DESC
      LIMIT 12
    `) as unknown as Record<string, unknown>[];

    /* Reputação: média das avaliações reais recebidas nos produtos dele */
    const reputation = (await sql`
      SELECT COALESCE(AVG(r.rating), 0)::float8 AS media,
             count(*)::int AS total
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${seller.id}
    `) as unknown as { media: number; total: number }[];

    /* Estatísticas públicas da Mini-Loja (Fase 6, ponto 1):
       - produtos publicados (total no catálogo)
       - clientes servidos (compradores distintos com pagamento confirmado) */
    const productCount = (await sql`
      SELECT count(*)::int AS n FROM products WHERE user_id = ${seller.id}
    `) as unknown as { n: number }[];

    const clientsCount = (await sql`
      SELECT count(DISTINCT o.user_id)::int AS n
      FROM orders o, jsonb_array_elements(o.items) AS item
      WHERE o.status IN ('pago', 'entregue')
        AND (item->>'seller_id')::int = ${seller.id}
    `) as unknown as { n: number }[];

    /* Últimas avaliações recebidas (com produto, nota e comentário) */
    const reviews = (await sql`
      SELECT r.id, r.rating, r.comment, r.created_at,
             u.name AS user_name, u.username AS user_username,
             p.name AS product_name
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE p.user_id = ${seller.id}
      ORDER BY r.created_at DESC
      LIMIT 10
    `) as unknown as Record<string, unknown>[];

    const media = Math.round(Number(reputation[0]?.media ?? 0) * 10) / 10;
    const total = Number(reputation[0]?.total ?? 0);

    /* Avaliação estimada (Fase 6, ponto 6): sem avaliações reais, mostra a
       média global da plataforma como estimativa, claramente marcada. */
    let ratingEstimado: number | null = null;
    if (total === 0) {
      const globalAvg = (await sql`
        SELECT COALESCE(AVG(rating), 4.5)::float8 AS media FROM reviews
      `) as unknown as { media: number }[];
      ratingEstimado = Math.round(Number(globalAvg[0]?.media ?? 4.5) * 10) / 10;
    }

    // Gamificação (Fase 7): nível, pontos e selos públicos do vendedor
    let gamificacao: {
      level: string;
      points: number;
      badges: { code: string; name: string; icon: string }[];
    } | null = null;
    try {
      const pointsRow = (await sql`
        SELECT points::int FROM seller_points WHERE user_id = ${seller.id} LIMIT 1
      `) as unknown as { points: number }[];
      const badgeRows = (await sql`
        SELECT b.code, b.name, b.icon
        FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = ${seller.id}
        ORDER BY ub.awarded_at DESC LIMIT 12
      `) as unknown as { code: string; name: string; icon: string }[];
      const { levelFor } = await import('@/lib/gamification');
      const pts = Number(pointsRow[0]?.points ?? 0);
      gamificacao = {
        points: pts,
        level: levelFor(pts).key,
        badges: badgeRows.map((b) => ({ code: String(b.code), name: String(b.name), icon: String(b.icon) })),
      };
    } catch {
      gamificacao = null;
    }

    return NextResponse.json({
      seller: {
        id: seller.id,
        name: seller.name,
        role: seller.role,
        role_label: ROLE_LABELS[seller.role],
        username: seller.username,
        cidade: seller.cidade,
        especialidade: seller.especialidade,
        bio: seller.bio,
        portfolio_bio: seller.portfolio_bio,
        portfolio_image: seller.portfolio_image,
        portfolio_url: seller.portfolio_url,
        // Fase 16: foto de perfil (prioridade sobre portfolio_image)
        profile_image: seller.profile_image,
        // Reputação
        media_avaliacoes: media,
        total_avaliacoes: total,
        rating_estimado: ratingEstimado,
        // Estatísticas da Mini-Loja
        total_produtos: Number(productCount[0]?.n ?? 0),
        total_clientes: Number(clientsCount[0]?.n ?? 0),
        // Gamificação (Fase 7)
        gamificacao,
        // 🔒 Fase 6 (ponto 2): whatsapp/telefone REMOVIDOS do payload público
      },
      items,
      products,
      reviews: reviews.map((r) => ({
        id: Number(r.id),
        rating: Number(r.rating),
        comment: (r.comment as string) ?? '',
        created_at: String(r.created_at),
        user_name: (r.user_name as string) ?? 'Cliente AngoStart',
        user_username: (r.user_username as string) ?? null,
        product_name: (r.product_name as string) ?? null,
      })),
    });
  } catch (error) {
    console.error('[API portfolio/[username]] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar o portfólio.' }, { status: 503 });
  }
}
