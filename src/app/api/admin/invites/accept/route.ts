import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { acceptInvite, logAdminAudit } from '@/lib/admin-invites';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/invites/accept — primeiro acesso do admin limitado.
 * Corpo: { email, code } (código de convite de 8 caracteres recebido por email)
 *
 * Valida o convite (existe + hash + não expirado + não aceite), cria a conta
 * com role='admin_limitado' (SEM palavra-passe utilizável) e devolve o JWT
 * Bearer — o gate mostra de imediato o QR para ativar o 2FA obrigatório.
 *
 * 🌐 Público, mas com rate limit de 5 tentativas/minuto por IP.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'invite-accept'), 5, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas. Aguarda 1 minuto.' },
      { status: 429 }
    );
  }

  let body: { email?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').trim().toUpperCase();
  if (!email || !code) {
    return NextResponse.json(
      { error: 'Introduz o email e o código de convite recebido por email.' },
      { status: 400 }
    );
  }
  if (code.length !== 8) {
    return NextResponse.json({ error: 'O código de convite tem 8 caracteres.' }, { status: 400 });
  }

  try {
    const result = await acceptInvite(email, code);

    if (!result.ok) {
      await logAdminAudit({
        email,
        event: 'invite_failed',
        detail: `motivo: ${result.reason}`,
        ip: clientKey(request, 'audit'),
      });
      const messages: Record<string, string> = {
        invalid: 'Código de convite inválido para este email.',
        expired: 'O convite expirou — pede um novo ao administrador.',
        account_exists: 'Este email já tem conta — usa o código diário no acesso normal.',
        already_accepted: 'Este convite já foi usado. Entra com o código diário.',
      };
      return NextResponse.json({ error: messages[result.reason] }, { status: 401 });
    }

    await logAdminAudit({
      userId: result.user.id,
      email: result.user.email,
      event: 'invite_accepted',
      detail: 'conta admin_limitado criada',
      ip: clientKey(request, 'audit'),
    });

    const token = signToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    });
    return NextResponse.json({
      ok: true,
      token,
      user: result.user,
      message: 'Conta criada — ativa agora o 2FA.',
    });
  } catch (error) {
    console.error('[API admin/invites/accept] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível aceitar o convite agora.' }, { status: 503 });
  }
}
