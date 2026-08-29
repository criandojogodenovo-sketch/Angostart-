import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSeller } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/portfolio/items/[id] — remove um trabalho (apenas o dono). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Trabalho inválido.' }, { status: 400 });
  }

  try {
    const deleted = (await sql`
      DELETE FROM portfolio_items
      WHERE id = ${id} AND user_id = ${auth.user.id}
      RETURNING id
    `) as unknown as { id: number }[];

    if (!deleted[0]) {
      return NextResponse.json({ error: 'Trabalho não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API portfolio/items] Erro no DELETE:', error);
    return NextResponse.json({ error: 'Não foi possível remover o trabalho.' }, { status: 503 });
  }
}
