import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { isSafeHttpUrl, requireSeller, sanitizeMultiline, sanitizeText } from '@/lib/security';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 24;

/**
 * POST /api/portfolio/items — adiciona um trabalho ao portfólio
 * (título + descrição + imagem por URL https).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { title?: string; description?: string; image_url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const title = sanitizeText(body.title, 100);
  const description = sanitizeMultiline(body.description, 600);
  const imageUrl = body.image_url?.trim() ?? '';

  if (title.length < 2) {
    return NextResponse.json({ error: 'Indica um título para o trabalho.' }, { status: 400 });
  }
  if (!isSafeHttpUrl(imageUrl)) {
    return NextResponse.json(
      { error: 'O link da imagem deve começar por https:// e ser um endereço válido.' },
      { status: 400 }
    );
  }

  try {
    const count = (await sql`
      SELECT count(*)::int AS n FROM portfolio_items WHERE user_id = ${auth.user.id}
    `) as unknown as { n: number }[];
    if ((count[0]?.n ?? 0) >= MAX_ITEMS) {
      return NextResponse.json(
        { error: `O portfólio pode ter no máximo ${MAX_ITEMS} trabalhos.` },
        { status: 409 }
      );
    }

    const inserted = (await sql`
      INSERT INTO portfolio_items (user_id, title, description, image_url, position)
      VALUES (${auth.user.id}, ${title}, ${description}, ${imageUrl}, ${count[0]?.n ?? 0})
      RETURNING id, title, description, image_url, position, created_at
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ ok: true, item: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API portfolio/items] Erro no POST:', error);
    return NextResponse.json({ error: 'Não foi possível adicionar o trabalho.' }, { status: 503 });
  }
}
