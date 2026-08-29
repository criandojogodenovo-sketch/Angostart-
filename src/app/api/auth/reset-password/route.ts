import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import { signToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password — redefinir senha com token do email.
 * Corpo: { token, password }
 * O token é de uso único e expira em 1 hora (guardado como SHA-256).
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'reset-password'), 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda alguns minutos.' }, { status: 429 });
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Link de recuperação inválido.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'A nova senha deve ter pelo menos 8 caracteres.' },
      { status: 400 }
    );
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return NextResponse.json(
      { error: 'A nova senha deve misturar letras e números.' },
      { status: 400 }
    );
  }

  try {
    const bcrypt = await import('bcryptjs');
    const tokenHash = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    ).toString('hex');

    const rows = (await sql`
      SELECT r.id, r.user_id, u.email, u.role
      FROM password_resets r
      JOIN users u ON u.id = r.user_id AND u.blocked = FALSE
      WHERE r.token_hash = ${tokenHash}
        AND r.used = FALSE
        AND r.expires_at > now()
      LIMIT 1
    `) as unknown as { id: number; user_id: number; email: string; role: string }[];

    const reset = rows[0];
    if (!reset) {
      return NextResponse.json(
        { error: 'Link inválido ou expirado — pede um novo em "Esqueci a senha".' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Uso único: marca primeiro (evita corridas), depois atualiza a senha
    const used = (await sql`
      UPDATE password_resets SET used = TRUE
      WHERE id = ${reset.id} AND used = FALSE
      RETURNING id
    `) as unknown as { id: number }[];
    if (!used[0]) {
      return NextResponse.json({ error: 'Este link já foi utilizado.' }, { status: 400 });
    }

    await sql`
      UPDATE users SET password_hash = ${passwordHash} WHERE id = ${reset.user_id}
    `;
    // Invalida outros tokens pendentes da conta
    await sql`
      UPDATE password_resets SET used = TRUE
      WHERE user_id = ${reset.user_id} AND used = FALSE
    `;

    const jwtToken = signToken({
      id: reset.user_id,
      email: reset.email,
      role: reset.role as Parameters<typeof signToken>[0]['role'],
    });

    return NextResponse.json({ ok: true, token: jwtToken });
  } catch (error) {
    console.error('[API reset-password] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível redefinir agora. Tenta novamente.' }, { status: 503 });
  }
}
