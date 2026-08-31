import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sanitizeText, clientKey, rateLimit } from '@/lib/security';
import { CIDADES_ANGOLA } from '@/lib/cidades-angola';
import { keywordsReady, isUndefinedColumnError, markKeywordsUnavailable } from '@/lib/keywords-db';
import { isGenericKeyword } from '@/lib/keywords';

export const dynamic = 'force-dynamic';

/**
 * Fase 11 — Categorias de prestadores. Cada categoria tem termos-raiz
 * pesquisados na especialidade/bio (ILIKE) — cobre variações reais
 * ("Programador web" entra em Programação, "Electricista" em
 * Electricidade, etc.).
 */
const CATEGORIAS: { value: string; label: string; terms: string[] }[] = [
  { value: 'design', label: 'Design', terms: ['design', 'designer', 'gráfico', 'grafico'] },
  { value: 'programacao', label: 'Programação', terms: ['programa', 'desenvolvedor', 'developer', 'software', 'web', 'informática', 'informatica'] },
  { value: 'marketing', label: 'Marketing', terms: ['marketing', 'social media', 'seo', 'publicidade', 'divulga'] },
  { value: 'electricidade', label: 'Electricidade', terms: ['electric', 'eletric'] },
  { value: 'canalizacao', label: 'Canalização', terms: ['canaliz', 'canaliza'] },
  { value: 'beleza', label: 'Beleza', terms: ['beleza', 'cabele', 'barber', 'barbeiro', 'manicure', 'unhas'] },
  { value: 'fotografia', label: 'Fotografia', terms: ['foto', 'vídeo', 'video', 'filmag'] },
  { value: 'educacao', label: 'Educação', terms: ['educ', 'professor', 'explicador', 'aula', 'tutor', 'formação', 'formacao'] },
  { value: 'traducao', label: 'Tradução', terms: ['tradu', 'tradutor', 'línguas', 'linguas'] },
  { value: 'reparacoes', label: 'Reparações', terms: ['repara', 'consert', 'técnico', 'tecnico', 'instala'] },
  { value: 'mecanica', label: 'Mecânica', terms: ['mecânic', 'mecanic', 'auto'] },
  { value: 'costura', label: 'Costura', terms: ['costur', 'alfaiat', 'modista'] },
];

function categoriaTerms(value: string): string[] | null {
  const cat = CATEGORIAS.find((c) => c.value === value);
  return cat ? cat.terms : null;
}

interface PrestadorRow {
  id: number;
  name: string;
  username: string | null;
  role: string;
  cidade: string | null;
  especialidade: string | null;
  bio: string | null;
  portfolio_image: string | null;
  ai_rating: number | null;
  ai_summary: string | null;
  /** Fase 15: nº de produtos com keywords que correspondem à pesquisa. */
  kw_matches?: number;
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
 *  - categoria: design | programacao | marketing | … (ver CATEGORIAS)
 *  - ordenar: 'rating' (padrão) | 'nome' | 'recentes'
 *
 * 🔒 Apenas contas de prestadores ativas e não bloqueadas; expõe apenas
 * dados públicos (sem email, sem telefone — Fase 6: contacto é pelo chat).
 *
 * Fase 15: a pesquisa também percorre as KEYWORDS dos produtos do
 * prestador (ex.: procurar "design" encontra quem tenha "design" nas
 * keywords dos serviços) e quem tem correspondências fica À FRENTE —
 * exceto para palavras genéricas ("barato", "grátis"…), que nunca
 * recebem o boost (anti-manipulação).
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'prestadores-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  try {
    return await handleSearch(request, true);
  } catch (error) {
    /* Coluna keywords em falta (deploy antes da migração) → repete sem. */
    if (isUndefinedColumnError(error)) {
      markKeywordsUnavailable();
      return handleSearch(request, false);
    }
    throw error;
  }
}

async function handleSearch(
  request: NextRequest,
  withKeywords: boolean
): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = sanitizeText(searchParams.get('q') ?? '', 80);
  const cidade = sanitizeText(searchParams.get('cidade') ?? '', 60);
  const tipo = searchParams.get('tipo') ?? '';
  const categoriaParam = sanitizeText(searchParams.get('categoria') ?? '', 40).toLowerCase();
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
  const catTerms = categoriaTerms(categoriaParam);
  const kwReady = withKeywords && (await keywordsReady());

  /* Fase 15: nº de produtos cujas keywords correspondem à pesquisa —
     ordenação dá-lhes prioridade (só quando há pesquisa não-genérica). */
  const kwMatchesSelect =
    kwReady && like && !isGenericKeyword(q)
      ? sql`, (SELECT count(*)::int FROM products pk
                JOIN unnest(pk.keywords) kk ON TRUE
               WHERE pk.user_id = u.id AND kk ILIKE ${like}) AS kw_matches`
      : sql``;
  const kwSearchOr =
    kwReady && like
      ? sql`OR EXISTS (SELECT 1 FROM products pk2
                        JOIN unnest(pk2.keywords) kk2 ON TRUE
                       WHERE pk2.user_id = u.id AND kk2 ILIKE ${like})`
      : sql``;

  /* Fase 14: ordenação padrão começa pela nota IA (destaque de perfis
     de qualidade — users.ai_seller_rating), depois reputação clássica.
     Fase 15: com pesquisa por keywords, quem tem correspondências sobe. */
  const orderBy =
    ordenar === 'nome'
      ? sql`u.name ASC`
      : ordenar === 'recentes'
        ? sql`u.created_at DESC`
        : kwReady && like && !isGenericKeyword(q)
          ? sql`kw_matches DESC NULLS LAST, u.ai_seller_rating DESC NULLS LAST, media_avaliacoes DESC NULLS LAST, total_avaliacoes DESC, u.name ASC`
          : sql`u.ai_seller_rating DESC NULLS LAST, media_avaliacoes DESC NULLS LAST, total_avaliacoes DESC, u.name ASC`;

  try {
    const rows = (await sql`
      SELECT u.id, u.name, u.username, u.role, u.cidade, u.especialidade,
             u.bio, u.portfolio_image,
             u.ai_seller_rating::float8 AS ai_rating,
             u.ai_rating_summary AS ai_summary${kwMatchesSelect},
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
             OR u.cidade ILIKE ${like}
             ${kwSearchOr})
        AND (${cidadeValida}::text IS NULL OR u.cidade ILIKE ${cidadeValida})
        AND (
          ${catTerms === null}::boolean
          /* termos com % (parciais): "electric" apanha "Electricista…" */
          OR u.especialidade ILIKE ANY(string_to_array(${catTerms ? catTerms.map((t) => `%${t}%`).join(',') : ''}, ',')::text[])
          OR u.bio ILIKE ANY(string_to_array(${catTerms ? catTerms.map((t) => `%${t}%`).join(',') : ''}, ',')::text[])
        )
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
      /* Fase 11: lista de categorias para o frontend popular os filtros */
      categorias: CATEGORIAS.map(({ value, label }) => ({ value, label })),
    });
  } catch (error) {
    console.error('[API /api/prestadores] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível pesquisar os prestadores agora.' },
      { status: 503 }
    );
  }
}
