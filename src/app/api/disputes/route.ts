import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Fase 6 (ponto 7) — Sistema de Disputas.
 *
 * POST /api/disputes — cliente abre disputa sobre uma encomenda paga/entregue.
 *   Corpo: { order_id, reason }
 * GET  /api/disputes — disputas do utilizador autenticado (como cliente).
 */

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para abrir uma disputa.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'disputes-post'), 5, 60 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas disputas abertas seguidas. Aguarda um pouco.' },
      { status: 429 }
    );
  }

  let body: { order_id?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const orderId = Number(body.order_id);
  const reason = sanitizeMultiline(body.reason, 2000);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Encomenda inválida.' }, { status: 400 });
  }
  if (reason.length < 15) {
    return NextResponse.json(
      { error: 'Explica o problema com pelo menos 15 caracteres para a equipa poder ajudar.' },
      { status: 400 }
    );
  }

  try {
    const orders = (await sql`
      SELECT id, user_id, status, items, total_kz::float8 AS total_kz
      FROM orders WHERE id = ${orderId} LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number;
      status: string;
      items: { id?: number; seller_id?: number }[];
      total_kz: number;
    }[];

    const order = orders[0];
    if (!order) {
      return NextResponse.json({ error: 'Encomenda não encontrada.' }, { status: 404 });
    }
    if (order.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Só podes abrir disputas sobre as tuas próprias encomendas.' },
        { status: 403 }
      );
    }
    if (!['pago', 'entregue'].includes(order.status)) {
      return NextResponse.json(
        { error: 'Só é possível disputar encomendas com pagamento confirmado.' },
        { status: 400 }
      );
    }

    const existing = (await sql`
      SELECT 1 FROM disputes
      WHERE order_id = ${orderId} AND status = 'aberta'
      LIMIT 1
    `) as unknown as unknown[];
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Já existe uma disputa aberta para esta encomenda.' },
        { status: 409 }
      );
    }

    // Vendedor alvo: primeiro seller_id presente nos itens (podem ser vários;
    // a equipa admin gere a encomenda como um todo).
    const sellerId = (order.items ?? []).find((i) => Number(i?.seller_id) > 0)?.seller_id ?? null;

    const inserted = (await sql`
      INSERT INTO disputes (order_id, user_id, seller_id, reason)
      VALUES (${orderId}, ${user.id}, ${sellerId}, ${reason})
      RETURNING id, status, created_at
    `) as unknown as { id: number; status: string; created_at: string }[];

    return NextResponse.json(
      { ok: true, dispute: inserted[0] },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API disputes POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível abrir a disputa agora.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para ver as tuas disputas.' },
      { status: 401 }
    );
  }

  try {
    const rows = (await sql`
      SELECT d.id, d.order_id, d.reason, d.status, d.created_at, d.resolved_at, d.resolution,
             o.total_kz::float8 AS total_kz,
             s.name AS seller_name
      FROM disputes d
      JOIN orders o ON o.id = d.order_id
      LEFT JOIN users s ON s.id = d.seller_id
      WHERE d.user_id = ${user.id}
      ORDER BY d.created_at DESC
      LIMIT 50
    `) as unknown as Record<string, unknown>[];

    const disputes = rows.map((r) => ({
      id: Number(r.id),
      order_id: Number(r.order_id),
      reason: String(r.reason ?? ''),
      status: String(r.status ?? 'aberta'),
      created_at: String(r.created_at),
      resolved_at: r.resolved_at ? String(r.resolved_at) : null,
      resolution: (r.resolution as string) ?? null,
      total_kz: Number(r.total_kz ?? 0),
      seller_name: (r.seller_name as string) ?? null,
    }));

    return NextResponse.json({ disputes });
  } catch (error) {
    console.error('[API disputes GET] Erro:', error);
    return NextResponse.json({ disputes: [] });
  }
}
