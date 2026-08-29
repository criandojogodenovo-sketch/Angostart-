import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/users/[id] — bloqueia/desbloqueia um utilizador.
 * 🔒 Apenas role='admin'. O admin não pode bloquear-se a si próprio.
 * Utilizadores bloqueados perdem imediatamente a sessão (getAuthUser
 * rejeita contas bloqueadas) e não conseguem entrar de novo.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Utilizador inválido.' }, { status: 400 });
  }

  let body: { blocked?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  if (typeof body.blocked !== 'boolean') {
    return NextResponse.json({ error: 'Indica blocked: true ou false.' }, { status: 400 });
  }
  if (id === auth.user.id && body.blocked) {
    return NextResponse.json(
      { error: 'Não podes bloquear a tua própria conta de administrador.' },
      { status: 400 }
    );
  }

  try {
    const updated = (await sql`
      UPDATE users SET blocked = ${body.blocked} WHERE id = ${id}
      RETURNING id, email, role, blocked::boolean
    `) as unknown as { id: number; email: string; role: string; blocked: boolean }[];

    if (!updated[0]) {
      return NextResponse.json({ error: 'Utilizador não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user: updated[0] });
  } catch (error) {
    console.error('[API admin/users/[id]] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o utilizador.' }, { status: 503 });
  }
}
