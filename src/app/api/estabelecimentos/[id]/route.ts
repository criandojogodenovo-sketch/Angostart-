import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import type { BusinessProfile } from '@/lib/business';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/estabelecimentos/[id] — página pública do estabelecimento
 * (mini-loja estilo Google Business/Booking):
 *  - dados do estabelecimento (nome, categoria, descrição, morada,
 *    horário, localização fixa, fotos);
 *  - serviços/produtos à venda do responsável (checkout normal da app).
 *
 * 🔒 Privacidade: mostra apenas dados COMERCIAIS públicos — nunca
 * telefone/email/GPS pessoal do proprietário.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'business-detail'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Estabelecimento inválido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT b.*, u.name AS owner_name, u.username AS owner_username, u.cidade
      FROM business_profiles b
      JOIN users u ON u.id = b.user_id
      WHERE b.id = ${id} AND b.active = TRUE AND u.blocked = FALSE
      LIMIT 1
    `) as unknown as BusinessProfile[];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Estabelecimento não encontrado.' }, { status: 404 });
    }
    const business = rows[0];

    // Produtos/serviços à venda do responsável
    const products = (await sql`
      SELECT id, name, description, price_kz, type, image_url, rating, is_hot
      FROM products
      WHERE user_id = ${business.user_id}
      ORDER BY is_hot DESC, created_at DESC
      LIMIT 24
    `) as unknown as {
      id: number;
      name: string;
      description: string | null;
      price_kz: number;
      type: string;
      image_url: string | null;
      rating: number | null;
      is_hot: boolean;
    }[];

    return NextResponse.json({ business, products }, { status: 200 });
  } catch (error) {
    console.error('[API estabelecimentos/[id] GET] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível carregar o estabelecimento agora.' },
      { status: 503 }
    );
  }
}
