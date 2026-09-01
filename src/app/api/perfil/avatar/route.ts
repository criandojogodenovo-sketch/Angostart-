import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { isInternalMediaUrl } from '@/lib/payments-manual';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/perfil/avatar — guardar a FOTO DE PERFIL (Fase 16).
 *
 * O upload do ficheiro é CLIENT-SIDE (POST /api/upload/image → namespace
 * `perfil/<userId>/…`). Esta rota apenas valida o URL e o dono, e grava
 * em `users.profile_image`.
 *
 * 🔒 SEGURANÇA:
 * - Qualquer utilizador autenticado (cliente ou vendedor).
 * - O URL tem de ser interno e pertencer ao PRÓPRIO utilizador:
 *   `/api/media/perfil/<id>/…` com <id> === user.id.
 * - `{ clear: true }` remove a foto (NULL).
 *
 * GET /api/perfil/avatar — devolve { profile_image } atual.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  try {
    const rows = (await sql`
      SELECT profile_image FROM users WHERE id = ${user.id} LIMIT 1
    `) as unknown as { profile_image: string | null }[];
    return NextResponse.json({ profile_image: rows[0]?.profile_image ?? null });
  } catch (error) {
    console.error('[API perfil/avatar GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a foto.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }

  if (!rateLimit(clientKey(request, `avatar:${user.id}`), 15, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas alterações seguidas. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: { profile_image?: unknown; clear?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  /* ── Remover foto ── */
  if (body.clear === true) {
    try {
      await sql`UPDATE users SET profile_image = NULL WHERE id = ${user.id}`;
      return NextResponse.json({ ok: true, profile_image: null });
    } catch (error) {
      console.error('[API perfil/avatar DELETE] Erro:', error);
      return NextResponse.json({ error: 'Não foi possível remover a foto.' }, { status: 503 });
    }
  }

  /* ── Guardar foto ── */
  const url =
    typeof body.profile_image === 'string' ? body.profile_image.trim() : '';

  if (!url) {
    return NextResponse.json({ error: 'Envia profile_image ou clear: true.' }, { status: 400 });
  }

  // 1. Formato interno (namespace perfil/) — nunca URLs externos
  if (!isInternalMediaUrl(url)) {
    return NextResponse.json(
      {
        error:
          'A foto de perfil deve ser enviada pelo upload da AngoStart (escolhe um ficheiro).',
      },
      { status: 400 }
    );
  }

  // 2. Dono do namespace — `/api/media/perfil/<id>/…` com <id> === user.id
  const ownerMatch = url.match(/^\/api\/media\/perfil\/(\d+)\//);
  if (!ownerMatch || Number(ownerMatch[1]) !== user.id) {
    return NextResponse.json(
      { error: 'Esta foto não pertence à tua conta.' },
      { status: 403 }
    );
  }

  try {
    await sql`
      UPDATE users SET profile_image = ${url}
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ ok: true, profile_image: url });
  } catch (error) {
    console.error('[API perfil/avatar POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a foto.' }, { status: 503 });
  }
}
