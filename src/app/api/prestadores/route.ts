import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sanitizeText, clientKey, rateLimit } from '@/lib/security';
import { CIDADES_ANGOLA } from '@/lib/cidades-angola';

export const dynamic = 'force-dynamic';

interface PrestadorRow {
  id: number;
  name: string;
  username: string | null;
  role: string;
  cidade: string | null;
  especialidade: string | null;
  bio: string | null;
  portfolio_image: string | null;
  produtos: number;
  media_avaliacoes: number | null;
  total_avaliacoes: number;
}

/**
 * GET /api/prestadores — pesquisa pública de prestadores de serviços.
 *
 * Parâmetros:
 *  - q:     texto livre (nome, especialidade, bio, cidade) com ILIKE
 *  - cidade: filtro exato pela lista de cidades de Angola
 *  - tipo:  'domicilio' | 'remoto'
 *  - ordenar: 'rating' (padrão) | 'nome' | 'recentes'
 *
 * 🔒 Apenas contas de prestadores ativas e não bloqueadas; expõe apenas
 * dados públicos (sem email, sem telefone — Fase 6: contacto é pelo chat).
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'prestadores-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = sanitizeText(searchParams.get('q') ?? '', 80);
  const cidade = sanitizeText(searchParams.get('cidade') ?? '', 60);
  const tipo = searchParams.get('tipo') ?? '';
  const ordenar = searchParams.get('ordenar') ?? 'rating';

  const roles =
    tipo === 'domicilio'
      ? ['prestador_domicilio']
      : tipo === 'remoto'
        ? ['prestador_remoto']
        : ['prestador_domicilio', 'prestador_remoto'];

  const cidadeValida =
    cidade && Object.keys(CIDADES_ANGOLA).includes(cidade.toLowerCase())
      ? cidade.toLowerCase()
      : null;

  const like = q ? `%${q}%` : null;
  const orderBy =
    ordenar === 'nome'
      ? sql`u.name ASC`
      : ordenar === 'recentes'
        ? sql`u.created_at DESC`
        : sql`media_avaliacoes DESC NULLS LAST, total_avaliacoes DESC, u.name ASC`;

  try {
    const rows = (await sql`
      SELECT u.id, u.name, u.username, u.role, u.cidade, u.especialidade,
             u.bio, u.portfolio_image,
             (SELECT count(*)::int FROM products p WHERE p.user_id = u.id) AS produtos,
             (SELECT AVG(r.rating)::float8 FROM reviews r
                JOIN products p2 ON p2.id = r.product_id
               WHERE p2.user_id = u.id) AS media_avaliacoes,
             (SELECT count(*)::int FROM reviews r
                JOIN products p2 ON p2.id = r.product_id
               WHERE p2.user_id = u.id) AS total_avaliacoes
      FROM users u
      WHERE u.role = ANY(${roles}::text[])
        AND u.blocked = FALSE
        AND (${like}::text IS NULL
             OR u.name ILIKE ${like}
             OR u.especialidade ILIKE ${like}
             OR u.bio ILIKE ${like}
             OR u.cidade ILIKE ${like})
        AND (${cidadeValida}::text IS NULL OR u.cidade ILIKE ${cidadeValida})
      ORDER BY ${orderBy}
      LIMIT 48
    `) as unknown as PrestadorRow[];

    return NextResponse.json({
      prestadores: rows.map((r) => ({
        ...r,
        media_avaliacoes:
          r.media_avaliacoes === null ? null : Number(r.media_avaliacoes),
        total_avaliacoes: Number(r.total_avaliacoes),
        produtos: Number(r.produtos),
      })),
      total: rows.length,
    });
  } catch (error) {
    console.error('[API /api/prestadores] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível pesquisar os prestadores agora.' },
      { status: 503 }
    );
  }
}
