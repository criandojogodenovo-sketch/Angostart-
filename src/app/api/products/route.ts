import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { FALLBACK_PRODUCTS, isProductType, type Product } from '@/lib/products-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/products
 * Parâmetros opcionais: ?type=infoproduto|produto_fisico|servico_domicilio|servico_remoto
 *                       ?q=texto  ?featured=1
 * Se a base de dados Neon estiver inacessível, devolve o catálogo de
 * fallback para que o site continue a funcionar.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const q = searchParams.get('q')?.trim();
  const featured = searchParams.get('featured');

  try {
    let rows: Product[];

    if (type && isProductType(type)) {
      rows = (await sql`
        SELECT id, name, description, price_kz, type, icon, gradient,
               featured::boolean, rating::float8, stock
        FROM products
        WHERE type = ${type}
        ORDER BY featured DESC, id ASC
      `) as unknown as Product[];
    } else if (q) {
      const like = `%${q}%`;
      rows = (await sql`
        SELECT id, name, description, price_kz, type, icon, gradient,
               featured::boolean, rating::float8, stock
        FROM products
        WHERE name ILIKE ${like} OR description ILIKE ${like}
        ORDER BY featured DESC, id ASC
      `) as unknown as Product[];
    } else if (featured === '1') {
      rows = (await sql`
        SELECT id, name, description, price_kz, type, icon, gradient,
               featured::boolean, rating::float8, stock
        FROM products
        WHERE featured = TRUE
        ORDER BY id ASC
      `) as unknown as Product[];
    } else {
      rows = (await sql`
        SELECT id, name, description, price_kz, type, icon, gradient,
               featured::boolean, rating::float8, stock
        FROM products
        ORDER BY featured DESC, id ASC
      `) as unknown as Product[];
    }

    return NextResponse.json({ products: rows, source: 'neon' });
  } catch (error) {
    console.error('[API /api/products] Erro no Neon:', error);

    // Fallback em memória — mantém o site funcional
    let fallback = FALLBACK_PRODUCTS;
    if (type && isProductType(type)) {
      fallback = fallback.filter((p) => p.type === type);
    }
    if (q) {
      const needle = q.toLowerCase();
      fallback = fallback.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.description.toLowerCase().includes(needle)
      );
    }
    if (featured === '1') {
      fallback = fallback.filter((p) => p.featured);
    }

    return NextResponse.json(
      { products: fallback, source: 'fallback' },
      { status: 200 }
    );
  }
}
