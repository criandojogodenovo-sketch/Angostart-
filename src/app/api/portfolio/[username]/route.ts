import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ROLE_LABELS, type Role } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ username: string }> };

/**
 * GET /api/portfolio/[username] — portfólio PÚBLICO de um vendedor
 * (página /portfolio/[username]).
 * Não expõe email nem dados sensíveis — apenas o número para o CTA
 * WhatsApp do prestador (números de negócio).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { username: rawUsername } = await context.params;
  const username = decodeURIComponent(rawUsername).trim().toLowerCase();

  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    return NextResponse.json({ error: 'Portfólio não encontrado.' }, { status: 404 });
  }

  try {
    const rows = (await sql`
      SELECT id, name, role, username, cidade, especialidade, bio,
             portfolio_bio, portfolio_image, portfolio_url, telefone
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
      telefone: string | null;
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

    /* Reputação do vendedor (média ponderada = média das avaliações reais
       recebidas nos produtos dele — Fase R) */
    const reputation = (await sql`
      SELECT COALESCE(AVG(r.rating), 0)::float8 AS media,
             count(*)::int AS total
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${seller.id}
    `) as unknown as { media: number; total: number }[];

    return NextResponse.json({
      seller: {
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
        // Reputação (média das avaliações dos produtos + nº de avaliações)
        media_avaliacoes: Math.round(Number(reputation[0]?.media ?? 0) * 10) / 10,
        total_avaliacoes: Number(reputation[0]?.total ?? 0),
        // Número apenas para contacto de negócio (CTA WhatsApp)
        whatsapp: seller.telefone,
      },
      items,
      products,
    });
  } catch (error) {
    console.error('[API portfolio/[username]] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar o portfólio.' }, { status: 503 });
  }
}
