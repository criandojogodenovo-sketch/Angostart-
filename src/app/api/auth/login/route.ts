import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { publicUser, signToken, type UserRow } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { logAdminAudit } from '@/lib/admin-invites';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login (genérico — clientes e vendedores)
 * Corpo: { email, password }
 * Devolve { token, user } — o `user.role` indica o perfil autenticado.
 * 🔒 admin_limitado NÃO entra aqui: o acesso é por código diário + 2FA.
 * Auditoria: acessos de admins e todas as tentativas falhadas ficam
 * registados em admin_audit.
 */
export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Preenche o email e a palavra-passe para entrar.' },
      { status: 400 }
    );
  }

  if (!rateLimit(clientKey(request, 'login'), 10, 5 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas de entrada. Espera 5 minutos.' },
      { status: 429 }
    );
  }

  try {
    const rows = (await sql`
      SELECT id, name, email, role, username, telefone, bio, area_atuacao, cidade,
             especialidade, portfolio_url, blocked::boolean, password_hash,
             must_change_password::boolean, kyc_status, is_verified_bi::boolean,
             profile_image
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `) as unknown as UserRow[];

    const row = rows[0];
    if (!row || !row.password_hash) {
      await logAdminAudit({
        email,
        event: 'login_failed',
        detail: 'conta inexistente ou sem senha (admin_limitado não entra aqui)',
        ip: clientKey(request, 'audit'),
      });
      return NextResponse.json(
        { error: 'Email ou palavra-passe incorretos.' },
        { status: 401 }
      );
    }

    if (row.blocked) {
      await logAdminAudit({
        userId: row.id,
        email,
        event: 'login_failed',
        detail: 'conta bloqueada',
        ip: clientKey(request, 'audit'),
      });
      return NextResponse.json(
        { error: 'A tua conta foi bloqueada. Contacta o suporte via WhatsApp.' },
        { status: 403 }
      );
    }

    const passwordOk = await bcrypt.compare(password, row.password_hash);
    if (!passwordOk) {
      await logAdminAudit({
        userId: row.id,
        email,
        event: 'login_failed',
        detail: 'palavra-passe incorreta',
        ip: clientKey(request, 'audit'),
      });
      return NextResponse.json(
        { error: 'Email ou palavra-passe incorretos.' },
        { status: 401 }
      );
    }

    const user = publicUser(row);
    const token = signToken(user);

    if (user.role === 'admin' || user.role === 'admin_limitado') {
      await logAdminAudit({
        userId: user.id,
        email: user.email,
        event: 'login_admin',
        detail: `login com senha (${user.role})`,
        ip: clientKey(request, 'audit'),
      });
    }

    return NextResponse.json({ token, user });
  } catch (error) {
    console.error('[API auth/login] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível entrar agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}
