import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Fase 6 (ponto 12, inspiração Fiverr/Upwork) — Sistema de Propostas.
 * Para serviços complexos, o cliente descreve o que precisa e o prestador
 * aceita ou recusa.
 *
 * POST /api/proposals — cliente envia proposta sobre um serviço.
 *   Corpo: { service_id, description, budget_kz }
 * GET  /api/proposals — propostas do utilizador (enviadas e recebidas).
 */

const BUDGET_MIN = 500;
const BUDGET_MAX = 5_000_000;

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

  let body: { service_id?: unknown; description?: unknown; budget_kz?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const serviceId = Number(body.service_id);
  const description = sanitizeMultiline(body.description, 3000);
  const budget = Math.round(Number(body.budget_kz));

  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return NextResponse.json({ error: 'Serviço inválido.' }, { status: 400 });
  }
  if (description.length < 20) {
    return NextResponse.json(
      { error: 'Descreve o que precisas com pelo menos 20 caracteres.' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX) {
    return NextResponse.json(
      { error: `O orçamento deve estar entre ${BUDGET_MIN} e ${BUDGET_MAX} Kz.` },
      { status: 400 }
    );
  }

  try {
    const services = (await sql`
      SELECT id, user_id, type FROM products WHERE id = ${serviceId} LIMIT 1
    `) as unknown as { id: number; user_id: number | null; type: string }[];
    const service = services[0];
    if (!service) {
      return NextResponse.json({ error: 'Serviço não encontrado.' }, { status: 404 });
    }
    if (!service.user_id) {
      return NextResponse.json({ error: 'Este serviço não tem prestador.' }, { status: 400 });
    }
    if (service.user_id === user.id) {
      return NextResponse.json(
        { error: 'Não podes enviar uma proposta sobre o teu próprio serviço.' },
        { status: 400 }
      );
    }

    const inserted = (await sql`
      INSERT INTO proposals (service_id, client_id, provider_id, description, budget_kz)
      VALUES (${serviceId}, ${user.id}, ${service.user_id}, ${description}, ${budget})
      RETURNING id, status, created_at
    `) as unknown as { id: number; status: string; created_at: string }[];

    return NextResponse.json({ ok: true, proposal: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('[API proposals POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível enviar a proposta.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para ver as tuas propostas.' },
      { status: 401 }
    );
  }

  try {
    const rows = (await sql`
      SELECT pr.id, pr.service_id, pr.description, pr.budget_kz::float8 AS budget_kz,
             pr.status, pr.created_at, pr.answered_at,
             p.name AS service_name, p.price_kz::float8 AS service_price,
             client.name AS client_name, provider.name AS provider_name,
             (pr.client_id = ${user.id}) AS is_mine
      FROM proposals pr
      JOIN products p ON p.id = pr.service_id
      LEFT JOIN users client ON client.id = pr.client_id
      LEFT JOIN users provider ON provider.id = pr.provider_id
      WHERE pr.client_id = ${user.id} OR pr.provider_id = ${user.id}
      ORDER BY pr.created_at DESC
      LIMIT 50
    `) as unknown as Record<string, unknown>[];

    const proposals = rows.map((r) => ({
      id: Number(r.id),
      service_id: Number(r.service_id),
      service_name: (r.service_name as string) ?? null,
      service_price: Number(r.service_price ?? 0),
      description: String(r.description ?? ''),
      budget_kz: Number(r.budget_kz ?? 0),
      status: String(r.status ?? 'pendente'),
      created_at: String(r.created_at),
      answered_at: r.answered_at ? String(r.answered_at) : null,
      client_name: (r.client_name as string) ?? null,
      provider_name: (r.provider_name as string) ?? null,
      is_mine: Boolean(r.is_mine), // true = enviada pelo utilizador
    }));

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error('[API proposals GET] Erro:', error);
    return NextResponse.json({ proposals: [] });
  }
}
