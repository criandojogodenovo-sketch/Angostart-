import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin, clientKey, rateLimit } from '@/lib/security';
import { aiAvailable } from '@/lib/ai/chat';
import { verifyOrderProof } from '@/lib/ai-proof';

export const dynamic = 'force-dynamic';
/* Hotfix 502: mesma região da rota de chat (ver /api/ai/chat/route.ts). */
export const preferredRegion = 'iad1';

/**
 * POST /api/ai/verify-proof — Fase 14: (re)verificação por IA de visão do
 * comprovativo guardado numa encomenda.
 *
 * 🔒 Apenas Admin Total — a verificação AUTOMÁTICA acontece server-side no
 * momento da submissão do comprovativo (lib/ai-proof.ts chamado pelas rotas
 * de encomenda); este endpoint é a ferramenta de re-análise/auditoria do
 * painel admin.
 *
 * Corpo: { order_id } — o comprovativo é lido da própria encomenda
 * (orders.payment_proof); nada é confiado ao cliente.
 *
 * Regra de segurança (ver lib/ai-proof.ts): só aprova automaticamente com
 * confiança alta + valor + referência a coincidirem; caso contrário fica
 * `aguardando_validacao` com o parecer da IA gravado (orders.ai_verification).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, 'ai-verify-proof'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas verificações seguidas — aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: { order_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const orderId = Number(body.order_id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }

  const rows = (await sql`
    SELECT payment_proof, status FROM orders WHERE id = ${orderId} LIMIT 1
  `) as unknown as { payment_proof: string | null; status: string }[];
  const order = rows[0];
  if (!order) {
    return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
  }
  if (!order.payment_proof) {
    return NextResponse.json(
      { error: 'Esta encomenda não tem comprovativo anexado.' },
      { status: 400 }
    );
  }

  if (!aiAvailable()) {
    return NextResponse.json(
      { error: 'Verificação por IA temporariamente indisponível.', code: 'AI_UNAVAILABLE' },
      { status: 503 }
    );
  }

  const result = await verifyOrderProof(orderId, order.payment_proof);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    verdict: result.verdict,
    auto_approved: result.autoApproved,
  });
}
