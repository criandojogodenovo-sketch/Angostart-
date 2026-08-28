import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { publicUser, signToken, type UserRow } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login (genérico — clientes e vendedores)
 * Corpo: { email, password }
 * Devolve { token, user } — o `user.role` indica o perfil autenticado.
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

  try {
    const rows = (await sql`
      SELECT id, name, email, role, telefone, bio, area_atuacao, cidade,
             especialidade, portfolio_url, password_hash
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `) as unknown as UserRow[];

    const row = rows[0];
    if (!row || !row.password_hash) {
      return NextResponse.json(
        { error: 'Email ou palavra-passe incorretos.' },
        { status: 401 }
      );
    }

    const passwordOk = await bcrypt.compare(password, row.password_hash);
    if (!passwordOk) {
      return NextResponse.json(
        { error: 'Email ou palavra-passe incorretos.' },
        { status: 401 }
      );
    }

    const user = publicUser(row);
    const token = signToken(user);

    return NextResponse.json({ token, user });
  } catch (error) {
    console.error('[API auth/login] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível entrar agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}
