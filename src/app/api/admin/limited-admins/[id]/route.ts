import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, requireAdmin, sanitizeText } from '@/lib/security';
import { deleteLimitedAdmin, logAdminAudit } from '@/lib/admin-invites';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/limited-admins/[id] — atualiza o contacto WhatsApp do
 * admin limitado (Fase 5). O código diário é enviado MANUALMENTE pelo
 * admin total via WhatsApp — nenhum SDK pago está envolvido.
 * 🔒 Apenas role='admin'.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-limited-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 });
  }

  let body: { whatsapp_contact?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  // Normaliza: aceita vazio (remove) ou número angolano válido
  const raw = typeof body.whatsapp_contact === 'string' ? body.whatsapp_contact.trim() : '';
  if (raw.length === 0) {
    await sql`UPDATE users SET whatsapp_contact = NULL WHERE id = ${userId} AND role = 'admin_limitado'`;
    return NextResponse.json({ ok: true, whatsapp_contact: null });
  }

  const digits = raw.replace(/\D/g, '');
  const national = digits.startsWith('244') ? digits.slice(3) : digits;
  if (!/^9[1-9]\d{7}$/.test(national)) {
    return NextResponse.json(
      { error: 'Número de WhatsApp inválido — usa um número angolano (9XXXXXXXX).' },
      { status: 400 }
    );
  }

  const updated = (await sql`
    UPDATE users SET whatsapp_contact = ${'+244' + national}
    WHERE id = ${userId} AND role = 'admin_limitado'
    RETURNING id, whatsapp_contact
  `) as unknown as { id: number; whatsapp_contact: string }[];

  if (!updated[0]) {
    return NextResponse.json({ error: 'Admin limitado não encontrado.' }, { status: 404 });
  }

  await logAdminAudit({
    userId: auth.user.id,
    email: auth.user.email,
    event: 'limited_admin_whatsapp_updated',
    detail: `${sanitizeText(updated[0].whatsapp_contact, 20)} (conta #${userId})`,
    ip: clientKey(request, 'audit'),
  });

  return NextResponse.json({ ok: true, whatsapp_contact: updated[0].whatsapp_contact });
}

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
  if (!rateLimit(clientKey(request, 'admin-limited-delete'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
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
