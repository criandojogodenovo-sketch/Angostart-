import { NextRequest, NextResponse } from 'next/server';
import { addComment, listComments } from '@/lib/publicacoes-db';
import {
  requireRole,
  sanitizeMultiline,
  clientKey,
  rateLimit,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const MAX_COMMENT = 1000;

/**
 * GET /api/posts/[id]/comments — listar comentários (público).
 * Resposta: { comments: PostCommentRow[] } (mais antigos primeiro).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'post-comments-get'), 120, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Publicação inválida.' }, { status: 400 });
  }

  const comments = await listComments(id);
  return NextResponse.json(
    { comments },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * POST /api/posts/[id]/comments — comentar (autenticado).
 * Corpo: { content }. Sanitizado (XSS armazenado → zero) e limitado.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 10 comentários / 10 min por IP — anti-spam
  if (!rateLimit(clientKey(request, 'post-comments-add'), 10, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados comentários seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Publicação inválida.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  const content = sanitizeMultiline(
    (body as Record<string, unknown> | null)?.content,
    MAX_COMMENT
  );
  if (content.length < 2) {
    return NextResponse.json(
      { error: 'O comentário precisa de pelo menos 2 caracteres.' },
      { status: 400 }
    );
  }

  try {
    const comment = await addComment(id, auth.user.id, content);
    return NextResponse.json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    console.error('[API /api/posts/[id]/comments] POST falhou:', error);
    return NextResponse.json(
      { error: 'Não foi possível comentar. Tenta novamente.' },
      { status: 503 }
    );
  }
}
