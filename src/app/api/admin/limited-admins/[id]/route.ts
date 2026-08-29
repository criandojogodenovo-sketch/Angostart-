import { NextRequest, NextResponse } from 'next/server';
import { clientKey, requireAdmin } from '@/lib/security';
import { deleteLimitedAdmin, logAdminAudit } from '@/lib/admin-invites';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/limited-admins/[id] — remove uma conta admin_limitado
 * e os respetivos códigos diários (cascade).
 * 🔒 Apenas role='admin'.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 });
  }
  if (userId === auth.user.id) {
    return NextResponse.json({ error: 'Não podes remover a tua própria conta.' }, { status: 400 });
  }

  try {
    const removed = await deleteLimitedAdmin(userId);
    if (!removed) {
      return NextResponse.json({ error: 'Admin limitado não encontrado.' }, { status: 404 });
    }
    await logAdminAudit({
      userId: auth.user.id,
      email: auth.user.email,
      event: 'limited_admin_removed',
      detail: `conta #${userId} removida`,
      ip: clientKey(request, 'audit'),
    });
    return NextResponse.json({ ok: true, message: 'Admin limitado removido.' });
  } catch (error) {
    console.error('[API admin/limited-admins DELETE] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível remover a conta.' }, { status: 503 });
  }
}
