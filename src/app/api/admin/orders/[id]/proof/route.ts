import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin } from '@/lib/security';
import { KWIK_PROOF_MIME_TYPES } from '@/lib/kwik';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/orders/[id]/proof — devolve o comprovativo KWiK
 * (imagem ou PDF) de uma encomenda.
 *
 * 🔒 SEGURANÇA:
 * - Apenas admin (total) ou admin_limitado — `requireAnyAdmin` valida o
 *   Bearer JWT + role + 2FA em cada pedido.
 * - O comprovativo NUNCA fica num URL público: é servido em binário a
 *   partir da base de dados (coluna orders.payment_proof, base64).
 * - O cliente carrega o ficheiro com `fetch` + Authorization header
 *   (imagens via blob URL — o token nunca vai no <img src>).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT payment_proof, payment_proof_type, payment_proof_name
      FROM orders WHERE id = ${id} LIMIT 1
    `) as unknown as {
      payment_proof: string | null;
      payment_proof_type: string | null;
      payment_proof_name: string | null;
    }[];

    const order = rows[0];
    if (!order?.payment_proof) {
      return NextResponse.json(
        { error: 'Esta encomenda não tem comprovativo anexado.' },
        { status: 404 }
      );
    }

    /* ── Extrai o base64 do data URL (formato guardado no servidor) ── */
    const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(
      order.payment_proof
    );
    if (!match) {
      return NextResponse.json({ error: 'Comprovativo corrompido.' }, { status: 500 });
    }

    const mime = (KWIK_PROOF_MIME_TYPES as readonly string[]).includes(
      (order.payment_proof_type ?? match[1]).toLowerCase()
    )
      ? (order.payment_proof_type ?? match[1]).toLowerCase()
      : 'application/octet-stream';

    const buffer = Buffer.from(match[2], 'base64');
    const safeName = (order.payment_proof_name ?? 'comprovativo').replace(
      /[^A-Za-z0-9._-]+/g,
      '_'
    );
    const extension = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] ?? 'bin';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="encomenda-${id}-${safeName}.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[API admin/orders/proof] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível obter o comprovativo.' },
      { status: 503 }
    );
  }
}
