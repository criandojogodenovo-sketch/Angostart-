import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAnyAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders?status=aguardando_validacao&method=kwik — fila de
 * validação de comprovativos (KWiK, PayPay, Multicaixa Express…).
 *
 * 🔒 admin + admin_limitado (o limitado vê APENAS isto — sem utilizadores
 * nem produtos). Por omissão devolve as encomendas com comprovativo à
 * espera de validação.
 *
 * `method` (opcional): kwik | paypay | multicaixa_express | whatsapp |
 * carteira | momenu — filtro por método de pagamento (Fase 8).
 *
 * ⚠️ A lista NUNCA inclui o base64 do comprovativo (payment_proof) —
 * o ficheiro é obtido separadamente em /api/admin/orders/[id]/proof.
 */
const VALID_METHODS = [
  'kwik',
  'paypay',
  'multicaixa_express',
  'whatsapp',
  'carteira',
  'momenu',
];

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const searchParams = new URL(request.url).searchParams;
  const statusParam = searchParams.get('status');
  const status = [
    'aguardando_validacao',
    'pendente',
    'pago',
    'falhou',
    'rejeitado',
    'entregue',
  ].includes(statusParam ?? '')
    ? statusParam!
    : 'aguardando_validacao';

  const methodParam = searchParams.get('method');
  const methodClause =
    methodParam && VALID_METHODS.includes(methodParam)
      ? sql` AND payment_method = ${methodParam}`
      : sql``;

  try {
    const orders = (await sql`
      SELECT id, customer_name, customer_phone, customer_email, items, total_kz,
             status, delivery_type, notes, comprovativo_url, delivery_address,
             payment_method, payment_proof_name, payment_proof_type,
             (payment_proof IS NOT NULL) AS has_payment_proof,
             admin_note, validated_at, created_at
      FROM orders
      WHERE status = ${status}${methodClause}
      ORDER BY created_at DESC
      LIMIT 100
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[API admin/orders] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível listar as encomendas.' }, { status: 503 });
  }
}
