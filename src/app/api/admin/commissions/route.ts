import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/security';
import {
  getCommissionOverview,
  setCommissionRate,
  setSellerOverride,
  validScope,
} from '@/lib/commissions';

export const dynamic = 'force-dynamic';

/**
 * Fase 7 (ponto 4) — Comissões flexíveis (apenas admins).
 *
 * GET   /api/admin/commissions — taxas, overrides, auditoria e relatório.
 * PATCH /api/admin/commissions — { scope, percent } → taxa por tipo.
 * POST  /api/admin/commissions — { seller_id, percent | null } → override.
 */

async function requireAdminUser(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return { error: 'Entra na tua conta.', status: 401 as const };
  if (!isAdminRole(user.role)) return { error: 'Sem permissão.', status: 403 as const };
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const overview = await getCommissionOverview();
    return NextResponse.json(overview);
  } catch (error) {
    console.error('[API admin/commissions GET] Erro:', error);
    return NextResponse.json(
      { rates: [], overrides: [], audit: [], report: { por_categoria: [], por_mes: [], total_comissoes: 0 } },
      { status: 503 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { scope?: unknown; percent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  if (!validScope(body.scope)) {
    return NextResponse.json(
      { error: 'Escopo inválido — usa produto, servico_domicilio ou freelancer.' },
      { status: 400 }
    );
  }

  try {
    const result = await setCommissionRate(auth.user.id, body.scope, body.percent);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, scope: body.scope, percent: result.percent });
  } catch (error) {
    console.error('[API admin/commissions PATCH] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a taxa.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { seller_id?: unknown; percent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  try {
    const result = await setSellerOverride(
      auth.user.id,
      Number(body.seller_id),
      body.percent === undefined ? undefined : body.percent
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      seller_id: Number(body.seller_id),
      percent: result.percent,
    });
  } catch (error) {
    console.error('[API admin/commissions POST] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível guardar o override.' }, { status: 503 });
  }
}
