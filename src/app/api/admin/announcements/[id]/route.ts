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
 * PATCH /api/admin/announcements/[id] — edita título/conteúdo/ativo.
 * DELETE /api/admin/announcements/[id] — remove o anúncio.
 * 🔒 admin + admin_limitado (limitado não pode tocar em 'exclusivo').
 */

const LIMITED_FORBIDDEN = (type: string) => type === 'exclusivo';

async function loadAnnouncement(id: number) {
  const rows = (await sql`
    SELECT id, type, created_by FROM announcements WHERE id = ${id} LIMIT 1
  `) as unknown as { id: number; type: string; created_by: number | null }[];
  return rows[0] ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'announcements-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const annId = Number(id);
  if (!Number.isInteger(annId) || annId <= 0) {
    return NextResponse.json({ error: 'Anúncio inválido.' }, { status: 400 });
  }

  const existing = await loadAnnouncement(annId);
  if (!existing) {
    return NextResponse.json({ error: 'Anúncio não encontrado.' }, { status: 404 });
  }
  if (auth.user.role !== 'admin' && LIMITED_FORBIDDEN(existing.type)) {
    return NextResponse.json(
      { error: 'Anúncios exclusivos só podem ser geridos pelo administrador total.' },
      { status: 403 }
    );
  }

  let body: { title?: unknown; content?: unknown; active?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const title = body.title !== undefined ? sanitizeText(body.title, 100) : undefined;
  const content = body.content !== undefined ? sanitizeMultiline(body.content, 800) : undefined;
  const active = body.active === undefined ? undefined : Boolean(body.active);

  if (title !== undefined && title.length < 3) {
    return NextResponse.json({ error: 'O título deve ter pelo menos 3 letras.' }, { status: 400 });
  }
  if (content !== undefined && content.length < 5) {
    return NextResponse.json({ error: 'Conteúdo demasiado curto.' }, { status: 400 });
  }

  try {
    const updated = (await sql`
      UPDATE announcements SET
        title = COALESCE(${title ?? null}, title),
        content = COALESCE(${content ?? null}, content),
        active = COALESCE(${active ?? null}, active),
        updated_at = now()
      WHERE id = ${annId}
      RETURNING id, title, content, type, target_role, active::boolean, updated_at
    `);
    return NextResponse.json({ ok: true, announcement: updated[0] });
  } catch (error) {
    console.error('[API admin/announcements PATCH] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o anúncio.' }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const annId = Number(id);
  if (!Number.isInteger(annId) || annId <= 0) {
    return NextResponse.json({ error: 'Anúncio inválido.' }, { status: 400 });
  }

  const existing = await loadAnnouncement(annId);
  if (!existing) {
    return NextResponse.json({ error: 'Anúncio não encontrado.' }, { status: 404 });
  }
  if (auth.user.role !== 'admin' && LIMITED_FORBIDDEN(existing.type)) {
    return NextResponse.json(
      { error: 'Anúncios exclusivos só podem ser geridos pelo administrador total.' },
      { status: 403 }
    );
  }

  try {
    await sql`DELETE FROM announcements WHERE id = ${annId}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API admin/announcements DELETE] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível remover o anúncio.' }, { status: 503 });
  }
}
