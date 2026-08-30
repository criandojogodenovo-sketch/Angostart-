import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { validatePassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/change-password (Fase 9)
 * Corpo: { current_password, new_password }
 * Troca a senha do utilizador autenticado e limpa a flag
 * `must_change_password` (imposta a utilizadores antigos pela migração).
 * A nova senha tem de cumprir a política forte (≥8, A-Z, a-z, 0-9,
 * símbolo, não-comum) e ser diferente da atual.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }

  if (!rateLimit(clientKey(request, 'change-password'), 10, 5 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas. Espera 5 minutos.' },
      { status: 429 }
    );
  }

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const currentPassword =
    typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'Indica a palavra-passe atual e a nova palavra-passe.' },
      { status: 400 }
    );
  }

  const forte = validatePassword(newPassword);
  if (!forte.ok) {
    return NextResponse.json({ error: forte.error }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: 'A nova palavra-passe deve ser diferente da atual.' },
      { status: 400 }
    );
  }

  try {
    const rows = (await sql`
      SELECT password_hash FROM users WHERE id = ${user.id} LIMIT 1
    `) as unknown as { password_hash: string | null }[];

    const hash = rows[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
      return NextResponse.json(
        { error: 'A palavra-passe atual está incorreta.' },
        { status: 401 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await sql`
      UPDATE users
      SET password_hash = ${newHash}, must_change_password = FALSE
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ ok: true, message: 'Palavra-passe atualizada com sucesso.' });
  } catch (error) {
    console.error('[API auth/change-password] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível atualizar a palavra-passe agora.' },
      { status: 503 }
    );
  }
}
