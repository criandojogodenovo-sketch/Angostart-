import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  clientKey,
  isSafeHttpUrl,
  rateLimit,
  requireSeller,
  sanitizeMultiline,
  sanitizeText,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portfolio — portfólio do vendedor autenticado (editor).
 * PUT /api/portfolio — atualiza os campos públicos do portfólio.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rows = (await sql`
      SELECT id, name, email, role, username, cidade, especialidade, bio,
             portfolio_bio, portfolio_image, portfolio_url, telefone
      FROM users WHERE id = ${auth.user.id} LIMIT 1
    `) as unknown as Record<string, unknown>[];

    const items = (await sql`
      SELECT id, title, description, image_url, position, created_at
      FROM portfolio_items WHERE user_id = ${auth.user.id}
      ORDER BY position ASC, created_at ASC
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ portfolio: rows[0] ?? null, items });
  } catch (error) {
    console.error('[API portfolio] Erro no GET:', error);
    return NextResponse.json({ error: 'Não foi possível carregar o portfólio.' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'portfolio-put'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: {
    portfolio_bio?: string;
    portfolio_image?: string;
    especialidade?: string;
    portfolio_url?: string;
    cidade?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  if (body.portfolio_image && !isSafeHttpUrl(body.portfolio_image)) {
    return NextResponse.json(
      { error: 'O link da foto deve começar por https://.' },
      { status: 400 }
    );
  }
  if (body.portfolio_url && !isSafeHttpUrl(body.portfolio_url)) {
    return NextResponse.json(
      { error: 'O link do portfólio deve começar por https://.' },
      { status: 400 }
    );
  }

  try {
    const updated = (await sql`
      UPDATE users
      SET portfolio_bio = ${sanitizeMultiline(body.portfolio_bio, 1000) || null},
          portfolio_image = ${body.portfolio_image?.trim() || null},
          especialidade = ${sanitizeText(body.especialidade, 80) || null},
          portfolio_url = ${body.portfolio_url?.trim() || null},
          cidade = ${sanitizeText(body.cidade, 60) || null}
      WHERE id = ${auth.user.id}
      RETURNING id, username, portfolio_bio, portfolio_image, especialidade, portfolio_url, cidade
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ ok: true, portfolio: updated[0] });
  } catch (error) {
    console.error('[API portfolio] Erro no PUT:', error);
    return NextResponse.json({ error: 'Não foi possível guardar o portfólio.' }, { status: 503 });
  }
}
