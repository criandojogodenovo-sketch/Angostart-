import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prestadores/availability?product_ids=1,2,3
 *
 * Devolve a disponibilidade (`is_available`) do prestador de CADA produto
 * de serviço ao domicílio pedido — usada no checkout ANTES de permitir o
 * pagamento: "O cliente NÃO pode pagar se o prestador estiver offline."
 *
 * 🔒 Pública (o carrinho aceita convidados), rate-limited, e expõe apenas
 * { product_id, is_available, seller_name } — sem contactos nem GPS.
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'availability-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('product_ids') ?? '';
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 2_147_483_647)
    ),
  ].slice(0, 50);

  if (ids.length === 0) {
    return NextResponse.json({ items: [] });
  }

  try {
    // ids já validados como inteiros positivos — passados como texto e
    // convertidos na BD (o driver neon() não tem .join)
    const rows = (await sql`
      SELECT p.id AS product_id, p.type,
             u.is_available, u.name AS seller_name
      FROM products p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ANY(string_to_array(${ids.join(',')}, ',')::int[])
    `) as unknown as {
      product_id: number;
      type: string;
      is_available: boolean | null;
      seller_name: string | null;
    }[];

    const items = ids.map((id) => {
      const row = rows.find((r) => r.product_id === id);
      // Produtos que não são de domicílio (ou sem prestador associado,
      // ex.: catálogo base) não bloqueiam o checkout.
      const isDomicilio = row?.type === 'servico_domicilio';
      return {
        product_id: id,
        is_domicilio: isDomicilio,
        is_available: isDomicilio ? Boolean(row?.is_available) : true,
        seller_name: row?.seller_name ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error('[API prestadores/availability] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível verificar a disponibilidade agora.' },
      { status: 503 }
    );
  }
}
