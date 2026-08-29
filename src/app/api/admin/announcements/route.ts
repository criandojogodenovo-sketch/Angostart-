import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  sanitizeMultiline,
  sanitizeText,
  clientKey,
  rateLimit,
  requireAnyAdmin,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Anúncios / promoções — painel admin (Fase 5).
 *
 * Permissões:
 *  - Admin TOTAL: todos os tipos, incluindo 'exclusivo' (comunicação interna).
 *  - Admin LIMITADO: apenas promo, destaque e novidade.
 */

const ALLOWED_TYPES_ALL = ['promo', 'destaque', 'novidade', 'exclusivo'] as const;
const ALLOWED_TYPES_LIMITED = ['promo', 'destaque', 'novidade'] as const;

const TARGET_ROLES = [
  'cliente',
  'criador',
  'prestador_domicilio',
  'prestador_remoto',
  'admin_limitado',
] as const;

interface AnnouncementBody {
  title?: unknown;
  content?: unknown;
  type?: unknown;
  target_role?: unknown;
}

function validateBody(body: AnnouncementBody, allowedTypes: readonly string[]) {
  const title = sanitizeText(body.title, 100);
  const content = sanitizeMultiline(body.content, 800);
  const type = typeof body.type === 'string' ? body.type : '';
  const targetRole =
    typeof body.target_role === 'string' && body.target_role !== '' && body.target_role !== 'todos'
      ? sanitizeText(body.target_role, 30)
      : null;

  if (title.length < 3) {
    return { error: 'O título deve ter pelo menos 3 letras.' as string };
  }
  if (content.length < 5) {
    return { error: 'Escreve o conteúdo do anúncio (mínimo 5 caracteres).' };
  }
  if (!allowedTypes.includes(type)) {
    return { error: `Tipo inválido — os permitidos são: ${allowedTypes.join(', ')}.` };
  }
  if (targetRole !== null && !(TARGET_ROLES as readonly string[]).includes(targetRole)) {
    return { error: 'Perfil de destino inválido.' };
  }
  return { title, content, type, targetRole };
}

/** GET — lista TODOS os anúncios (ativos e inativos) para o painel. */
export async function GET(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rows = await sql`
      SELECT a.id, a.title, a.content, a.type, a.target_role, a.active::boolean,
             a.created_at, u.name AS created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 50
    `;
    return NextResponse.json({ announcements: rows });
  } catch (error) {
    console.error('[API admin/announcements] Erro no GET:', error);
    return NextResponse.json({ announcements: [] });
  }
}

/** POST — cria um anúncio (tipo conforme o role do admin). */
export async function POST(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'announcements-post'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: AnnouncementBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const allowedTypes =
    auth.user.role === 'admin' ? ALLOWED_TYPES_ALL : ALLOWED_TYPES_LIMITED;
  const parsed = validateBody(body, allowedTypes);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const inserted = (await sql`
      INSERT INTO announcements (title, content, type, target_role, created_by)
      VALUES (${parsed.title}, ${parsed.content}, ${parsed.type}, ${parsed.targetRole}, ${auth.user.id})
      RETURNING id, title, content, type, target_role, active::boolean, created_at
    `);
    return NextResponse.json({ ok: true, announcement: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API admin/announcements] Erro no POST:', error);
    return NextResponse.json({ error: 'Não foi possível criar o anúncio agora.' }, { status: 503 });
  }
}
