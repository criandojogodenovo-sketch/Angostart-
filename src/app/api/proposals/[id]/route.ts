import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Fase 7 (ponto 1) — Negociação de propostas.
 *
 * PATCH /api/proposals/[id]
 *   { action: 'contrapropor', price_kz, deadline_days?, message? }
 *     → qualquer parte (exceto a autora da oferta em cima da mesa) pode
 *       contrapropor; o histórico fica em proposal_counters.
 *   { action: 'aceite' }
 *     → a parte que NÃO fez a oferta vigente aceita os termos; gera
 *       automaticamente um pedido (order) com o valor acordado (pago via
 *       KWiK manual + escrow) e notifica ambas as partes.
 *   { action: 'recusada' }   → fornecedor ou cliente encerra a negociação.
 *   { action: 'cancelada' }  → o cliente cancela a própria proposta pendente.
 *
 * GET /api/proposals/[id] — detalhe com histórico completo de contrapropostas
 * (visível a ambas as partes).
 */

const PRICE_MIN = 500;
const PRICE_MAX = 5_000_000;
const DEADLINE_MIN = 1;
const DEADLINE_MAX = 365;

interface ProposalRow {
  id: number;
  service_id: number;
  client_id: number;
  provider_id: number;
  status: string;
  price_kz: number;
  deadline_days: number | null;
  last_offer_by: number | null;
}

async function loadProposal(id: number): Promise<ProposalRow | null> {
  const rows = (await sql`
    SELECT id, service_id, client_id, provider_id, status,
           price_kz::float8 AS price_kz, deadline_days, last_offer_by
    FROM proposals WHERE id = ${id} LIMIT 1
  `) as unknown as ProposalRow[];
  return rows[0] ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  const { id } = await params;
  const proposalId = Number(id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: 'Proposta inválida.' }, { status: 400 });
  }

  try {
    const proposal = await loadProposal(proposalId);
    if (!proposal) {
      return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 });
    }
    if (proposal.client_id !== user.id && proposal.provider_id !== user.id) {
      return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    }

    const counters = (await sql`
      SELECT pc.id, pc.price_kz::float8 AS price_kz, pc.deadline_days, pc.message,
             pc.created_at, u.name AS author_name, pc.by_user_id
      FROM proposal_counters pc
      LEFT JOIN users u ON u.id = pc.by_user_id
      WHERE pc.proposal_id = ${proposalId}
      ORDER BY pc.created_at ASC, pc.id ASC
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({
      proposal: {
        ...proposal,
        is_mine: proposal.client_id === user.id,
        my_offer_standing: proposal.last_offer_by === user.id,
      },
      history: counters.map((c) => ({
        id: Number(c.id),
        price_kz: Number(c.price_kz),
        deadline_days:
          c.deadline_days === null || c.deadline_days === undefined ? null : Number(c.deadline_days),
        message: (c.message as string) ?? null,
        created_at: String(c.created_at),
        author_name: (c.author_name as string) ?? null,
        by_me: Number(c.by_user_id) === user.id,
      })),
    });
  } catch (error) {
    console.error('[API proposals/[id] GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a proposta.' }, { status: 503 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para gerir propostas.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, 'proposals-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const { id } = await params;
  const proposalId = Number(id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: 'Proposta inválida.' }, { status: 400 });
  }

  let body: {
    action?: unknown;
    price_kz?: unknown;
    deadline_days?: unknown;
    message?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const action = body.action;
  if (
    action !== 'aceite' &&
    action !== 'recusada' &&
    action !== 'cancelada' &&
    action !== 'contrapropor'
  ) {
    return NextResponse.json(
      { error: 'Ação inválida — usa «aceite», «recusada», «cancelada» ou «contrapropor».' },
      { status: 400 }
    );
  }

  try {
    const proposal = await loadProposal(proposalId);
    if (!proposal) {
      return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 });
    }

    const isProvider = proposal.provider_id === user.id;
    const isClient = proposal.client_id === user.id;
    if (!isProvider && !isClient) {
      return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    }
    if (proposal.status !== 'pendente') {
      return NextResponse.json({ error: 'Esta proposta já foi concluída.' }, { status: 409 });
    }

    /* ── Cancelar: só o cliente que enviou ── */
    if (action === 'cancelada') {
      if (!isClient) {
        return NextResponse.json(
          { error: 'Só o autor da proposta a pode cancelar.' },
          { status: 403 }
        );
      }
      await sql`
        UPDATE proposals SET status = 'cancelada', updated_at = now()
        WHERE id = ${proposalId} AND status = 'pendente'
      `;
      return NextResponse.json({ ok: true, status: 'cancelada' });
    }

    /* ── Recusar: fornecedor ou cliente ── */
    if (action === 'recusada') {
      await sql`
        UPDATE proposals SET status = 'recusada', answered_at = now(), updated_at = now()
        WHERE id = ${proposalId} AND status = 'pendente'
      `;
      const otherId = isClient ? proposal.provider_id : proposal.client_id;
      await pushNotification(
        otherId,
        'Proposta recusada',
        'A negociação foi encerrada pela outra parte.',
        isClient ? '/perfil' : '/dashboard/vendedor'
      );
      return NextResponse.json({ ok: true, status: 'recusada' });
    }

    /* ── Contrapropor: alterna a vez — quem tem a oferta na mesa não responde a si próprio ── */
    if (action === 'contrapropor') {
      if (proposal.last_offer_by === user.id) {
        return NextResponse.json(
          { error: 'A tua oferta está na mesa — aguarda a resposta da outra parte.' },
          { status: 409 }
        );
      }

      const price = Math.round(Number(body.price_kz));
      const deadlineDays =
        body.deadline_days === undefined || body.deadline_days === null || body.deadline_days === ''
          ? null
          : Math.round(Number(body.deadline_days));
      const message = sanitizeMultiline(body.message, 2000) || null;

      if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) {
        return NextResponse.json(
          { error: `O preço deve estar entre ${PRICE_MIN} e ${PRICE_MAX} Kz.` },
          { status: 400 }
        );
      }
      if (
        deadlineDays !== null &&
        (!Number.isInteger(deadlineDays) || deadlineDays < DEADLINE_MIN || deadlineDays > DEADLINE_MAX)
      ) {
        return NextResponse.json(
          { error: `O prazo deve estar entre ${DEADLINE_MIN} e ${DEADLINE_MAX} dias.` },
          { status: 400 }
        );
      }

      const updated = (await sql`
        UPDATE proposals
        SET price_kz = ${price}, deadline_days = ${deadlineDays},
            last_offer_by = ${user.id}, updated_at = now()
        WHERE id = ${proposalId} AND status = 'pendente'
        RETURNING id
      `) as unknown as { id: number }[];
      if (!updated[0]) {
        return NextResponse.json({ error: 'Esta proposta já foi concluída.' }, { status: 409 });
      }

      await sql`
        INSERT INTO proposal_counters (proposal_id, by_user_id, price_kz, deadline_days, message)
        VALUES (${proposalId}, ${user.id}, ${price}, ${deadlineDays}, ${message})
      `;

      const otherId = isClient ? proposal.provider_id : proposal.client_id;
      await pushNotification(
        otherId,
        'Contraproposta recebida',
        `Nova oferta de ${price} Kz — responde para fechar o negócio.`,
        isClient ? '/perfil' : '/dashboard/vendedor'
      );

      return NextResponse.json({ ok: true, status: 'pendente', price_kz: price, deadline_days: deadlineDays });
    }

    /* ── Aceitar: só quem NÃO fez a oferta vigente ── */
    if (proposal.last_offer_by === user.id) {
      return NextResponse.json(
        { error: 'Não podes aceitar a tua própria oferta — aguarda a outra parte.' },
        { status: 409 }
      );
    }

    // Dados para o pedido: produto + cliente + vendedor
    const ctx = (await sql`
      SELECT p.id, p.name, p.type, p.user_id AS seller_id,
             c.name AS client_name, c.email AS client_email, c.telefone AS client_phone
      FROM proposals pr
      JOIN products p ON p.id = pr.service_id
      JOIN users c ON c.id = pr.client_id
      WHERE pr.id = ${proposalId} LIMIT 1
    `) as unknown as {
      id: number;
      name: string;
      type: string;
      seller_id: number;
      client_name: string;
      client_email: string | null;
      client_phone: string | null;
    }[];

    const info = ctx[0];
    if (!info) {
      return NextResponse.json({ error: 'Produto da proposta não encontrado.' }, { status: 404 });
    }

    const totalKz = Math.round(proposal.price_kz);
    const deliveryType = info.type === 'servico_remoto' ? 'remoto' : 'entrega';
    const items = [
      {
        id: info.id,
        name: info.name,
        price_kz: totalKz,
        quantity: 1,
        seller_id: info.seller_id,
      },
    ];

    // Gera o pedido com o valor acordado (cliente paga via KWiK manual + escrow)
    const orderInserted = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz,
                          status, delivery_type, notes, user_id, payment_method)
      VALUES (
        ${info.client_name || 'Cliente AngoStart'},
        ${info.client_phone || '—'},
        ${info.client_email},
        ${JSON.stringify(items)}::jsonb,
        ${totalKz},
        'pendente',
        ${deliveryType},
        ${`Pedido gerado automaticamente da proposta #${proposalId} (negociação aceite)`},
        ${proposal.client_id},
        'kwik'
      )
      RETURNING id
    `) as unknown as { id: number }[];

    const orderId = orderInserted[0].id;

    const accepted = (await sql`
      UPDATE proposals
      SET status = 'aceite', answered_at = now(), accepted_at = now(),
          order_id = ${orderId}, updated_at = now()
      WHERE id = ${proposalId} AND status = 'pendente'
      RETURNING id
    `) as unknown as { id: number }[];
    if (!accepted[0]) {
      // Corrida: outra resposta chegou primeiro — não deixa pedido órfão
      await sql`DELETE FROM orders WHERE id = ${orderId}`;
      return NextResponse.json({ error: 'Esta proposta já foi concluída.' }, { status: 409 });
    }

    // Notificações: sino + Web Push + email com detalhes da negociação
    const otherId = isClient ? proposal.provider_id : proposal.client_id;
    await pushNotification(
      otherId,
      'Proposta aceite — pedido criado',
      `O acordo de ${totalKz} Kz foi aceite. Pedido #${orderId}.`,
      isClient ? '/perfil' : '/dashboard/vendedor'
    );
    notifyAcceptedEmails(proposal, info, totalKz, orderId).catch(() => {});

    return NextResponse.json({ ok: true, status: 'aceite', order_id: orderId });
  } catch (error) {
    console.error('[API proposals/[id] PATCH] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível responder à proposta.' }, { status: 503 });
  }
}

/** Emails de confirmação (ambas as partes) quando a proposta é aceite. */
async function notifyAcceptedEmails(
  proposal: ProposalRow,
  info: { name: string },
  totalKz: number,
  orderId: number
): Promise<void> {
  const parties = (await sql`
    SELECT id, email FROM users WHERE id IN (${proposal.client_id}, ${proposal.provider_id})
  `) as unknown as { id: number; email: string | null }[];

  const { sendProposalAcceptedEmail } = await import('@/lib/email');
  const appUrl = getAppUrl();

  for (const party of parties) {
    if (!party.email) continue;
    const isClient = party.id === proposal.client_id;
    await sendProposalAcceptedEmail(
      party.email,
      isClient ? 'cliente' : 'vendedor',
      info.name,
      totalKz,
      proposal.deadline_days,
      orderId,
      isClient ? `${appUrl}/perfil` : `${appUrl}/dashboard/vendedor`
    );
  }
}
