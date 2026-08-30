import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { publicUser, signToken, generateUniqueUsername, type UserRow } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeText, getRequestIp } from '@/lib/security';
import { validatePassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register/cliente
 * Corpo: { name, email, password, telefone, ref_code? }
 * Cria um utilizador com role='cliente' e devolve { token, user }.
 * Fase 9: senha forte obrigatória + ref_code de afiliado (opcional)
 * + signup_ip para deteção de fraude de afiliados.
 */
export async function POST(request: NextRequest) {
  let body: {
    name?: string;
    email?: string;
    password?: string;
    telefone?: string;
    ref_code?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const name = sanitizeText(body.name, 80);
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
  /* Fase 9: senha forte obrigatória (≥8, A-Z, a-z, 0-9, símbolo, não-comum). */
  const senhaForte = validatePassword(password);
  if (!senhaForte.ok) {
    return NextResponse.json({ error: senhaForte.error }, { status: 400 });
  }
  if (telefone.replace(/\D/g, '').length < 9) {
    return NextResponse.json(
      { error: 'Telefone inválido — indica pelo menos 9 dígitos (ex.: 958 176 915).' },
      { status: 400 }
    );
  }

  if (!rateLimit(clientKey(request, 'register'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas de registo. Aguarda um minuto.' },
      { status: 429 }
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

    /* Fase 9: código de afiliado que indicou a conta (opcional). */
    let referredBy: number | null = null;
    const refCode = (body.ref_code ?? '').trim().toUpperCase();
    if (refCode) {
      if (!/^[A-Z0-9-]{4,20}$/.test(refCode)) {
        return NextResponse.json(
          { error: 'Código de afiliado inválido — usa o formato AFG-XXXXXX.' },
          { status: 400 }
        );
      }
      const ref = (await sql`
        SELECT user_id FROM affiliates WHERE codigo_afiliado = ${refCode} LIMIT 1
      `) as unknown as { user_id: number }[];
      if (ref[0]?.user_id) referredBy = ref[0].user_id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const username = await generateUniqueUsername(name);

    const inserted = (await sql`
      INSERT INTO users (name, email, password_hash, phone, telefone, role, username, signup_ip, referred_by)
      VALUES (${name}, ${email}, ${passwordHash}, ${telefone}, ${telefone}, 'cliente', ${username}, ${getRequestIp(request)}, ${referredBy})
      RETURNING id, name, email, role, username, telefone, bio, area_atuacao, cidade, especialidade, portfolio_url, blocked::boolean
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
