import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Fase 18 — Estatísticas públicas da Home (prova social REAL).
 *
 * GET /api/home/stats →
 *   { vendedores_ativos, produtos_publicados, estabelecimentos, vendas_concluidas }
 *
 * ⚠️ Regra anti-fake do projeto: a Home NUNCA inventa números — mostra
 * apenas contagens reais da base de dados (ou o estado vazio amigável).
 * Contagens agregadas apenas — nenhum dado pessoal é exposto.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'home-stats'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const [vendedores, produtos, espacos, vendas] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM users WHERE role IN ('criador','prestador_domicilio','prestador_remoto')`,
      sql`SELECT COUNT(*)::int AS n FROM products`,
      sql`SELECT COUNT(*)::int AS n FROM business_profiles WHERE active = TRUE`,
      sql`SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('pago','entregue','concluido')`,
    ]);

    return NextResponse.json(
      {
        vendedores_ativos: vendedores[0]?.n ?? 0,
        produtos_publicados: produtos[0]?.n ?? 0,
        estabelecimentos: espacos[0]?.n ?? 0,
        vendas_concluidas: vendas[0]?.n ?? 0,
      },
      { status: 200, headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    console.error('[API /api/home/stats] Erro:', error);
    return NextResponse.json({ error: 'Estatísticas indisponíveis.' }, { status: 503 });
  }
}
