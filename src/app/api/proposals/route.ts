import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Fase 7 (ponto 1) — Propostas robustas com negociação de preço e prazo.
 *
 * POST /api/proposals — cliente envia proposta sobre um produto/serviço.
 *   Corpo: { service_id, description, price_kz, deadline_days? }
 *   Cria a proposta, o 1.º registo do histórico e notifica o vendedor
 *   (sino + push + email).
 * GET  /api/proposals — propostas do utilizador (enviadas e recebidas)
 *   com filtros ?status= e ?scope=enviadas|recebidas.
 */

const PRICE_MIN = 500;
const PRICE_MAX = 5_000_000;
const DEADLINE_MIN = 1;
const DEADLINE_MAX = 365;

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para enviar uma proposta.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'proposals-post'), 10, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  let body: {
    service_id?: unknown;
    description?: unknown;
    price_kz?: unknown;
    budget_kz?: unknown; // compatibilidade Fase 6
    deadline_days?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const serviceId = Number(body.service_id);
  const description = sanitizeMultiline(body.description, 3000);
  const rawPrice = body.price_kz ?? body.budget_kz;
  const price = Math.round(Number(rawPrice));
  const deadlineDays =
    body.deadline_days === undefined || body.deadline_days === null || body.deadline_days === ''
      ? null
      : Math.round(Number(body.deadline_days));

  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return NextResponse.json({ error: 'Produto/serviço inválido.' }, { status: 400 });
  }
  if (description.length < 20) {
    return NextResponse.json(
      { error: 'Descreve o que precisas com pelo menos 20 caracteres.' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) {
    return NextResponse.json(
      { error: `O preço proposto deve estar entre ${PRICE_MIN} e ${PRICE_MAX} Kz.` },
      { status: 400 }
    );
  }
  if (deadlineDays !== null && (!Number.isInteger(deadlineDays) || deadlineDays < DEADLINE_MIN || deadlineDays > DEADLINE_MAX)) {
    return NextResponse.json(
      { error: `O prazo deve estar entre ${DEADLINE_MIN} e ${DEADLINE_MAX} dias.` },
      { status: 400 }
    );
  }

  try {
    const services = (await sql`
      SELECT id, user_id, name FROM products WHERE id = ${serviceId} LIMIT 1
    `) as unknown as { id: number; user_id: number | null; name: string }[];
    const service = services[0];
    if (!service) {
      return NextResponse.json({ error: 'Produto/serviço não encontrado.' }, { status: 404 });
    }
    if (!service.user_id) {
      return NextResponse.json({ error: 'Este item não tem vendedor.' }, { status: 400 });
    }
    if (service.user_id === user.id) {
      return NextResponse.json(
        { error: 'Não podes enviar uma proposta sobre o teu próprio produto.' },
        { status: 400 }
      );
    }

    const inserted = (await sql`
      INSERT INTO proposals (service_id, client_id, provider_id, description, budget_kz,
                             price_kz, deadline_days, last_offer_by)
      VALUES (${serviceId}, ${user.id}, ${service.user_id}, ${description}, ${price},
              ${price}, ${deadlineDays}, ${user.id})
      RETURNING id, status, created_at
    `) as unknown as { id: number; status: string; created_at: string }[];

    const proposalId = inserted[0].id;

    // Histórico: termo de abertura da negociação
    await sql`
      INSERT INTO proposal_counters (proposal_id, by_user_id, price_kz, deadline_days, message)
      VALUES (${proposalId}, ${user.id}, ${price}, ${deadlineDays}, ${description})
    `;

    // Notifica o vendedor/prestador: sino + Web Push + email (melhor-esforço)
    await pushNotification(
      service.user_id,
      'Nova proposta recebida',
      `${user.name} propôs ${price} Kz para «${service.name}».`,
      '/dashboard/vendedor'
    );
    notifyNewProposalEmail(
      service.user_id,
      user.name,
      service.name,
      price,
      deadlineDays,
      proposalId
    ).catch(() => {});

    return NextResponse.json({ ok: true, proposal: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API proposals POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível enviar a proposta.' }, { status: 503 });
  }
}

/** Email de nova proposta ao vendedor (melhor-esforço). */
async function notifyNewProposalEmail(
  sellerId: number,
  clientName: string,
  serviceName: string,
  priceKz: number,
  deadlineDays: number | null,
  proposalId: number
): Promise<void> {
  const rows = (await sql`
    SELECT email FROM users WHERE id = ${sellerId} LIMIT 1
  `) as unknown as { email: string | null }[];
  const to = rows[0]?.email;
  if (!to) return;

  const { sendNewProposalEmail } = await import('@/lib/email');
  await sendNewProposalEmail(
    to,
    clientName,
    serviceName,
    priceKz,
    deadlineDays,
    `${getAppUrl()}/dashboard/vendedor`
  );
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para ver as tuas propostas.' },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const scope = url.searchParams.get('scope'); // enviadas | recebidas
  const validStatus = ['pendente', 'aceite', 'recusada', 'cancelada'];

  let statusClause = sql``;
  if (statusFilter && validStatus.includes(statusFilter)) {
    statusClause = sql` AND pr.status = ${statusFilter}`;
  }

  let scopeClause = sql``;
  if (scope === 'enviadas') {
    scopeClause = sql` AND pr.client_id = ${user.id}`;
  } else if (scope === 'recebidas') {
    scopeClause = sql` AND pr.provider_id = ${user.id}`;
  }

  try {
    const rows = (await sql`
      SELECT pr.id, pr.service_id, pr.description,
             pr.budget_kz::float8 AS budget_kz,
             pr.price_kz::float8 AS price_kz,
             pr.deadline_days, pr.status, pr.created_at, pr.answered_at,
             pr.updated_at, pr.order_id, pr.last_offer_by,
             (pr.last_offer_by = ${user.id}) AS my_offer_standing,
             p.name AS service_name, p.price_kz::float8 AS service_price, p.type AS service_type,
             client.name AS client_name, provider.name AS provider_name,
             (pr.client_id = ${user.id}) AS is_mine,
             (SELECT count(*)::int FROM proposal_counters pc WHERE pc.proposal_id = pr.id) AS rounds
      FROM proposals pr
      JOIN products p ON p.id = pr.service_id
      LEFT JOIN users client ON client.id = pr.client_id
      LEFT JOIN users provider ON provider.id = pr.provider_id
      WHERE (pr.client_id = ${user.id} OR pr.provider_id = ${user.id})
        ${statusClause}
        ${scopeClause}
      ORDER BY pr.updated_at DESC, pr.created_at DESC
      LIMIT 50
    `) as unknown as Record<string, unknown>[];

    const proposals = rows.map((r) => ({
      id: Number(r.id),
      service_id: Number(r.service_id),
      service_name: (r.service_name as string) ?? null,
      service_price: Number(r.service_price ?? 0),
      service_type: (r.service_type as string) ?? null,
      description: String(r.description ?? ''),
      budget_kz: Number(r.budget_kz ?? 0),
      price_kz: Number(r.price_kz ?? r.budget_kz ?? 0),
      deadline_days: r.deadline_days === null || r.deadline_days === undefined ? null : Number(r.deadline_days),
      status: String(r.status ?? 'pendente'),
      created_at: String(r.created_at),
      answered_at: r.answered_at ? String(r.answered_at) : null,
      updated_at: String(r.updated_at ?? r.created_at),
      order_id: r.order_id === null || r.order_id === undefined ? null : Number(r.order_id),
      my_offer_standing: Boolean(r.my_offer_standing),
      client_name: (r.client_name as string) ?? null,
      provider_name: (r.provider_name as string) ?? null,
      is_mine: Boolean(r.is_mine), // true = enviada pelo utilizador
      rounds: Number(r.rounds ?? 1),
    }));

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error('[API proposals GET] Erro:', error);
    return NextResponse.json({ proposals: [] });
  }
}
