import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { generateUniqueUsername } from '@/lib/auth';
import { clientKey, rateLimit, requireAdmin, sanitizeText } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/limited — cria um novo admin limitado (só valida comprovativos).
 * 🔒 Apenas role='admin' (painel /admin → "Adicionar Admin Limitado").
 * A nova conta nasce SEM 2FA ativada — o próprio deve ativar no primeiro
 * acesso (obrigatório para entrar nos painéis).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'admin-limited'), 5, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um minuto.' }, { status: 429 });
  }

  let body: { name?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const name = sanitizeText(body.name, 80);
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (name.length < 3) {
    return NextResponse.json({ error: 'Indica o nome do novo admin limitado.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'A palavra-passe deve ter pelo menos 8 caracteres.' },
      { status: 400 }
    );
  }

  try {
    const existing = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as unknown as { id: number }[];
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Já existe uma conta com este email.' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const username = await generateUniqueUsername(name);

    const inserted = (await sql`
      INSERT INTO users (name, email, password_hash, role, username)
      VALUES (${name}, ${email}, ${passwordHash}, 'admin_limitado', ${username})
      RETURNING id, name, email, role, username
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json(
      {
        ok: true,
        user: inserted[0],
        message: 'Admin limitado criado. Deve entrar e ativar o 2FA no painel.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API admin/limited] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível criar o admin limitado.' }, { status: 503 });
  }
}
