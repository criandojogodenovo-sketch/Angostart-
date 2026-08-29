import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sanitizeText, clientKey, rateLimit, requireRole } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/perfil/kyc — verificação de identidade simples (Fase 5).
 * Guarda BI e/ou NIF do vendedor/prestador (aumenta a confiança dos
 * clientes). Opcional — publicar continua possível sem preencher.
 * Corpo: { bi_number?, nif_number? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'kyc'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: { bi_number?: unknown; nif_number?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  // BI angolano (ex.: 004587896LA038): 9 dígitos + 2-5 alfanuméricos;
  // NIF: 9-10 dígitos.
  const biRaw = sanitizeText(body.bi_number, 20).toUpperCase().replace(/[\s-]/g, '');
  const nifRaw = sanitizeText(body.nif_number, 15).replace(/[\s-]/g, '');

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

  if (!bi && !nif) {
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
