import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sanitizeText, clientKey, rateLimit, requireRole } from '@/lib/security';
import { isInternalMediaUrl } from '@/lib/payments-manual';

export const dynamic = 'force-dynamic';

/**
 * GET /api/perfil/kyc — estado de verificação do utilizador autenticado
 * (número do BI mascarado, foto, status). Usado pelo cartão de
 * verificação do perfil (Fase 9).
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rows = (await sql`
      SELECT bi_number, nif_number, bi_document_url, kyc_status, is_verified_bi::boolean
      FROM users WHERE id = ${auth.user.id} LIMIT 1
    `) as unknown as {
      bi_number: string | null;
      nif_number: string | null;
      bi_document_url: string | null;
      kyc_status: string;
      is_verified_bi: boolean;
    }[];

    const row = rows[0];
    const bi = row?.bi_number ?? null;
    return NextResponse.json({
      bi_number: bi ? `${bi.slice(0, 3)}****${bi.slice(-2)}` : null,
      tem_bi: Boolean(bi),
      tem_foto: Boolean(row?.bi_document_url),
      bi_document_url: row?.bi_document_url ?? null,
      nif_number: row?.nif_number ?? null,
      kyc_status: row?.kyc_status ?? 'none',
      is_verified_bi: Boolean(row?.is_verified_bi),
    });
  } catch (error) {
    console.error('[API perfil/kyc] Erro no GET:', error);
    return NextResponse.json({ error: 'Não foi possível carregar agora.' }, { status: 503 });
  }
}

/**
 * POST /api/perfil/kyc — verificação de identidade (Fase 5 + Fase 9).
 * Guarda BI e/ou NIF + FOTO do documento (URL do Vercel Blob devolvido
 * por /api/upload/image). Fase 9: a aprovação é feita pelo admin
 * (/admin → Verificação de Identidade) — sem aprovação, o vendedor não
 * publica novos produtos.
 * Corpo: { bi_number?, nif_number?, bi_document_url? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'kyc'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { bi_number?: unknown; nif_number?: unknown; bi_document_url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  // BI angolano (ex.: 004587896LA038): 9 dígitos + 2-5 alfanuméricos;
  // NIF: 9-10 dígitos; foto do documento: URL interno do Blob.
  const biRaw = sanitizeText(body.bi_number, 20).toUpperCase().replace(/[\s-]/g, '');
  const nifRaw = sanitizeText(body.nif_number, 15).replace(/[\s-]/g, '');

  /* Fase 9: foto do BI (URL devolvido por /api/upload/image). */
  let biDocUrl: string | null | undefined;
  if (body.bi_document_url !== undefined) {
    const raw = typeof body.bi_document_url === 'string' ? body.bi_document_url.trim() : '';
    if (raw && isInternalMediaUrl(raw)) {
      biDocUrl = raw;
    } else if (raw) {
      return NextResponse.json(
        { error: 'A foto do BI deve ser enviada pelo upload da AngoStart.' },
        { status: 400 }
      );
    } else {
      biDocUrl = null;
    }
  }

  let bi: string | null = null;
  let nif: string | null = null;

  if (biRaw.length > 0) {
    if (!/^[0-9]{9}[A-Z0-9]{2,5}$/.test(biRaw)) {
      return NextResponse.json(
        { error: 'BI inválido — usa o formato do documento (ex.: 004587896LA038).' },
        { status: 400 }
      );
    }
    bi = biRaw;
  }
  if (nifRaw.length > 0) {
    if (!/^[0-9]{9,10}$/.test(nifRaw)) {
      return NextResponse.json(
        { error: 'NIF inválido — deve ter 9 ou 10 dígitos.' },
        { status: 400 }
      );
    }
    nif = nifRaw;
  }

  if (!bi && !nif && !biDocUrl) {
    return NextResponse.json(
      { error: 'Indica o número do BI ou do NIF (pelo menos um).' },
      { status: 400 }
    );
  }

  try {
    await sql`
      UPDATE users
      SET bi_number = COALESCE(${bi}, bi_number),
          nif_number = COALESCE(${nif}, nif_number),
          bi_document_url = COALESCE(${biDocUrl ?? null}, bi_document_url),
          kyc_status = CASE WHEN kyc_status = 'verified' THEN kyc_status ELSE 'pending' END
      WHERE id = ${auth.user.id}
    `;
    return NextResponse.json({
      ok: true,
      message: 'Dados guardados — aumentam a confiança dos clientes no teu perfil.',
      kyc_status: 'pending',
    });
  } catch (error) {
    console.error('[API perfil/kyc] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível guardar agora.' }, { status: 503 });
  }
}
