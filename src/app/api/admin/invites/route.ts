import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAdmin, sanitizeText } from '@/lib/security';
import {
  createInvite,
  listInvites,
  listLimitedAdmins,
  listDailyCodes,
  logAdminAudit,
  normalizeInviteEmail,
} from '@/lib/admin-invites';
import { sendAdminInviteEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/invites — dados da secção "Gerir Admins Limitados":
 * convites enviados, contas admin_limitado e histórico de códigos diários.
 * 🔒 Apenas role='admin'.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const [invites, limitedAdmins, dailyCodes] = await Promise.all([
      listInvites(),
      listLimitedAdmins(),
      listDailyCodes(),
    ]);
    return NextResponse.json({ invites, limitedAdmins, dailyCodes });
  } catch (error) {
    console.error('[API admin/invites GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os dados.' }, { status: 503 });
  }
}

/**
 * POST /api/admin/invites — cria/reemite um convite para admin limitado.
 * Corpo: { email, name? }
 * Gera código de 8 caracteres (24 h), guarda apenas o hash e envia por
 * email (Brevo). Se o email falhar (sem BREVO_API_KEY em dev), o código
 * é devolvido ao ADMIN na resposta para partilha manual — nunca quando
 * a entrega por email está ativa.
 * 🔒 Apenas role='admin'.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-invite'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um minuto antes de convidar novamente.' }, { status: 429 });
  }

  let body: { email?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const email = normalizeInviteEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
  }
  const name = sanitizeText(body.name, 80) || null;

  try {
    // Um convite nunca é criado para um email que já tem conta (evita conflitos)
    const existingRole = (await sql`
      SELECT role FROM users WHERE email = ${email} LIMIT 1
    `) as unknown as { role: string }[];
    if (existingRole.length > 0) {
      return NextResponse.json(
        {
          error:
            existingRole[0].role === 'admin_limitado'
              ? 'Este email já tem conta de admin limitado — usa "Enviar código diário".'
              : 'Já existe uma conta com este email.',
        },
        { status: 409 }
      );
    }

    const { code, expiresAt } = await createInvite(email, name, auth.user.id);
    const delivered = await sendAdminInviteEmail(email, name, code, expiresAt);
    await logAdminAudit({
      userId: auth.user.id,
      email: auth.user.email,
      event: 'invite_created',
      detail: `convite para ${email}`,
      ip: clientKey(request, 'audit'),
    });

    return NextResponse.json(
      {
        ok: true,
        delivered,
        expiresAt: expiresAt.toISOString(),
        // Código apenas quando o email NÃO pôde ser enviado (fallback manual)
        code: delivered ? undefined : code,
        message: delivered
          ? `Convite enviado para ${email} — válido 24 h.`
          : `Email não entregue (Brevo sem configurar). Código para partilha manual: ${code}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API admin/invites POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível criar o convite.' }, { status: 503 });
  }
}
