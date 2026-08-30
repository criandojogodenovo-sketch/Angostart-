import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  requireRole,
  sanitizeMultiline,
  clientKey,
  rateLimit,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Fase 11 — Sistema de comentários (produtos, vendedores e lojas).
 *
 * Diferente das avaliações (reviews = estrelas + compra confirmada):
 * qualquer conta autenticada pode comentar, sem estrelas.
 *
 * Tabela comments:
 *   id | user_id → users(id) | target_type ('product'|'seller'|'store')
 *   target_id | content | created_at
 *
 * Segurança:
 *  - Conteúdo sanitizado (anti-XSS armazenado — React também escapa).
 *  - Rate limit (10 comentários/min por IP+rota).
 *  - O alvo tem de existir (produto/vendedor/loja reais — sem IDs órfãos).
 *  - DELETE apenas do autor ou de administradores (moderação).
 */

const TARGET_TYPES = ['product', 'seller', 'store'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const MAX_CONTENT = 1000;
const MIN_CONTENT = 2;

function parseTarget(searchParams: URLSearchParams): { type: TargetType; id: number } | null {
  const type = searchParams.get('target_type');
  const id = Number(searchParams.get('target_id'));
  if (!type || !(TARGET_TYPES as readonly string[]).includes(type)) return null;
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: type as TargetType, id };
}

/** Verifica que o alvo existe e está visível (evita comentários órfãos). */
async function targetExists(type: TargetType, id: number): Promise<boolean> {
  if (type === 'product') {
    const rows = (await sql`SELECT 1 FROM products WHERE id = ${id} LIMIT 1`) as unknown as unknown[];
    return rows.length > 0;
  }
  if (type === 'seller') {
    const rows = (await sql`
      SELECT 1 FROM users
      WHERE id = ${id} AND blocked = FALSE
        AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
      LIMIT 1
    `) as unknown as unknown[];
    return rows.length > 0;
  }
  const rows = (await sql`SELECT 1 FROM stores WHERE id = ${id} LIMIT 1`) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * GET /api/comments?target_type=product&target_id=123
 * Lista pública (mais recentes primeiro) com nome/@username do autor.
 */
export async function GET(request: NextRequest) {
  const target = parseTarget(request.nextUrl.searchParams);
  if (!target) {
    return NextResponse.json(
      { error: 'target_type (product|seller|store) e target_id válidos são obrigatórios.' },
      { status: 400 }
    );
  }

  try {
    const rows = (await sql`
      SELECT c.id, c.content, c.created_at,
             c.user_id, u.name AS user_name, u.username AS user_username,
             u.is_verified_bi::boolean AS user_verified
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.target_type = ${target.type} AND c.target_id = ${target.id}
      ORDER BY c.created_at DESC
      LIMIT 200
    `) as unknown as {
      id: number;
      content: string;
      created_at: string;
      user_id: number | null;
      user_name: string | null;
      user_username: string | null;
      user_verified: boolean;
    }[];

    return NextResponse.json({ comments: rows, total: rows.length });
  } catch (error) {
    console.error('[API /api/comments] Erro no GET:', error);
    return NextResponse.json({ comments: [], total: 0 });
  }
}

/**
 * POST /api/comments — cria um comentário (conta autenticada, não bloqueada).
 * Corpo: { target_type: 'product'|'seller'|'store', target_id: number, content: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'comments-post'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Aguarda um momento antes de comentar novamente.' },
      { status: 429 }
    );
  }

  let body: { target_type?: unknown; target_id?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const params = new URLSearchParams();
  if (typeof body.target_type === 'string') params.set('target_type', body.target_type);
  if (body.target_id !== undefined) params.set('target_id', String(body.target_id));
  const target = parseTarget(params);
  if (!target) {
    return NextResponse.json(
      { error: 'target_type (product|seller|store) e target_id válidos são obrigatórios.' },
      { status: 400 }
    );
  }

  // sanitizeMultiline preserva quebras de linha e remove HTML ativo (XSS)
  const content = sanitizeMultiline(body.content, MAX_CONTENT);
  if (content.length < MIN_CONTENT) {
    return NextResponse.json(
      { error: `Escreve um comentário com pelo menos ${MIN_CONTENT} caracteres.` },
      { status: 400 }
    );
  }

  try {
    if (!(await targetExists(target.type, target.id))) {
      return NextResponse.json({ error: 'O alvo do comentário não existe.' }, { status: 404 });
    }

    const inserted = (await sql`
      INSERT INTO comments (user_id, target_type, target_id, content)
      VALUES (${auth.user.id}, ${target.type}, ${target.id}, ${content})
      RETURNING id, content, created_at, user_id
    `) as unknown as {
      id: number;
      content: string;
      created_at: string;
      user_id: number;
    }[];

    return NextResponse.json(
      {
        ok: true,
        comment: {
          ...inserted[0],
          user_name: auth.user.name,
          user_username: auth.user.username ?? null,
          user_verified: false,
        },
        message: 'Comentário publicado. Obrigado por participares!',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API /api/comments] Erro no POST:', error);
    return NextResponse.json(
      { error: 'Não foi possível publicar o comentário agora.' },
      { status: 503 }
    );
  }
}

/**
 * DELETE /api/comments?id=123 — o autor apaga o próprio comentário;
 * administradores podem apagar qualquer um (moderação).
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'ID de comentário inválido.' }, { status: 400 });
  }

  const isAdmin = auth.user.role === 'admin' || auth.user.role === 'admin_limitado';

  try {
    const deleted = (isAdmin
      ? await sql`
          DELETE FROM comments WHERE id = ${id} RETURNING id
        `
      : await sql`
          DELETE FROM comments WHERE id = ${id} AND user_id = ${auth.user.id} RETURNING id
        `) as unknown as { id: number }[];

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Comentário não encontrado ou sem permissão para apagar.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, deleted: deleted[0].id });
  } catch (error) {
    console.error('[API /api/comments] Erro no DELETE:', error);
    return NextResponse.json({ error: 'Não foi possível apagar agora.' }, { status: 503 });
  }
}
