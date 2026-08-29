import { NextRequest, NextResponse } from 'next/server';
import { clientKey, requireAdmin } from '@/lib/security';
import { deleteInvite, logAdminAudit } from '@/lib/admin-invites';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/invites/[id] — revoga/apaga um convite pendente.
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
  const inviteId = Number(id);
  if (!Number.isInteger(inviteId) || inviteId <= 0) {
    return NextResponse.json({ error: 'Convite inválido.' }, { status: 400 });
  }

  try {
    const removed = await deleteInvite(inviteId);
    if (!removed) {
      return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    }
    await logAdminAudit({
      userId: auth.user.id,
      email: auth.user.email,
      event: 'invite_revoked',
      detail: `convite #${inviteId} revogado`,
      ip: clientKey(request, 'audit'),
    });
    return NextResponse.json({ ok: true, message: 'Convite revogado.' });
  } catch (error) {
    console.error('[API admin/invites DELETE] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível revogar o convite.' }, { status: 503 });
  }
}
