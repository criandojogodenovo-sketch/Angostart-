import { NextRequest, NextResponse } from 'next/server';
import {
  ensureContactCode,
  isValidContactCode,
  listPosts,
  optionalAuthUser,
} from '@/lib/publicacoes-db';
import {
  requireSeller,
  sanitizeText,
  sanitizeMultiline,
  clientKey,
  rateLimit,
} from '@/lib/security';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/posts — feed público de Publicações.
 *
 * Query: ?meu=1 → apenas as minhas (autenticado).
 * Resposta: { posts: FeedPost[] } — autor, gostos, comentários,
 * contact_code e flags (liked_by_me/is_mine) quando autenticado.
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'posts-get'), 60, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um momento.' },
      { status: 429 }
    );
  }

  const mine = request.nextUrl.searchParams.get('meu') === '1';
  const viewer = await optionalAuthUser(request);

  if (mine && !viewer) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }

  const posts = await listPosts(viewer?.id ?? null, { onlyMine: mine });
  return NextResponse.json(
    { posts },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * POST /api/posts — criar Publicação (apenas vendedores).
 *
 * Corpo: { title, content, image_url?, contact_code? }
 * - image_url: APENAS /api/media/publicacoes/<meu-id>/… (upload próprio)
 * - contact_code: opcional — personaliza o código do vendedor
 *   (formato CONTATO-XXXX; conflito → 409 com o código actual).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  if (!rateLimit(clientKey(request, 'posts-create'), 10, 60 * 60_000)) {
    return NextResponse.json(
      { error: 'Publicaste demasiadas publicações na última hora. Aguarda um pouco.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  const { title, content, image_url, contact_code } =
    (body ?? {}) as Record<string, unknown>;

  const cleanTitle = sanitizeText(title, 200);
  const cleanContent = sanitizeMultiline(content, 2000);

  if (cleanTitle.length < 3) {
    return NextResponse.json(
      { error: 'O título precisa de pelo menos 3 caracteres.' },
      { status: 400 }
    );
  }
  if (cleanContent.length < 3) {
    return NextResponse.json(
      { error: 'O conteúdo precisa de pelo menos 3 caracteres.' },
      { status: 400 }
    );
  }

  // Imagem: apenas do namespace PRÓPRIO do vendedor (upload assinado)
  let cleanImage: string | null = null;
  if (typeof image_url === 'string' && image_url.length > 0) {
    const ownedPrefix = `/api/media/publicacoes/${user.id}/`;
    if (!image_url.startsWith(ownedPrefix) || image_url.length > 300) {
      return NextResponse.json(
        {
          error:
            'Imagem inválida — envia a foto pelo uploader da plataforma ' +
            '(a imagem tem de pertencer à tua conta).',
        },
        { status: 400 }
      );
    }
    cleanImage = image_url;
  }

  // Código de contacto (opcional, personalizável)
  let code: string | null = null;
  if (contact_code !== undefined && contact_code !== null && contact_code !== '') {
    if (!isValidContactCode(contact_code)) {
      return NextResponse.json(
        {
          error:
            'Código inválido — formato CONTATO-LETRAS/NÚMEROS (4 a 12, ex.: CONTATO-ANGOLA).',
        },
        { status: 400 }
      );
    }
    const result = await ensureContactCode(user.id, contact_code);
    if (result.conflict) {
      return NextResponse.json(
        {
          error: 'Esse código já pertence a outro vendedor. Escolhe outro.',
          contact_code: result.code,
        },
        { status: 409 }
      );
    }
    code = result.code;
  } else {
    const result = await ensureContactCode(user.id);
    code = result.code;
  }

  try {
    const inserted = (await sql`
      INSERT INTO posts (user_id, title, content, image_url, contact_code)
      VALUES (${user.id}, ${cleanTitle}, ${cleanContent}, ${cleanImage}, ${code})
      RETURNING id, created_at
    `) as unknown as { id: number; created_at: string | Date }[];

    const post = inserted[0];
    return NextResponse.json(
      {
        ok: true,
        post: {
          id: post.id,
          title: cleanTitle,
          content: cleanContent,
          image_url: cleanImage,
          contact_code: code,
          created_at: new Date(post.created_at).toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API /api/posts] POST falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível publicar. Tenta novamente.' },
      { status: 503 }
    );
  }
}
