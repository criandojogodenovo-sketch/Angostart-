import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { publicUser, signToken, type UserRow } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register/cliente
 * Corpo: { name, email, password, telefone }
 * Cria um utilizador com role='cliente' e devolve { token, user }.
 */
export async function POST(request: NextRequest) {
  let body: {
    name?: string;
    email?: string;
    password?: string;
    telefone?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const name = body.name?.trim() ?? '';
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  const telefone = body.telefone?.trim() ?? '';

  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Indica o teu nome completo (mínimo 3 letras).' },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Email inválido — verifica o endereço escrito.' },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'A palavra-passe deve ter pelo menos 6 caracteres.' },
      { status: 400 }
    );
  }
  if (telefone.replace(/\D/g, '').length < 9) {
    return NextResponse.json(
      { error: 'Telefone inválido — indica pelo menos 9 dígitos (ex.: 958 176 915).' },
      { status: 400 }
    );
  }

  try {
    const existing = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as unknown as { id: number }[];

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Já existe uma conta com este email. Tenta entrar em vez de criar conta.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const inserted = (await sql`
      INSERT INTO users (name, email, password_hash, phone, telefone, role)
      VALUES (${name}, ${email}, ${passwordHash}, ${telefone}, ${telefone}, 'cliente')
      RETURNING id, name, email, role, telefone, bio, area_atuacao, cidade, especialidade, portfolio_url
    `) as unknown as UserRow[];

    const user = publicUser(inserted[0]);
    const token = signToken(user);

    return NextResponse.json({ token, user }, { status: 201 });
  } catch (error) {
    console.error('[API auth/register/cliente] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível criar a conta agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}
