import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getEffectiveCommissionPercent } from '@/lib/commissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/commission — taxa de comissão EFETIVA do vendedor
 * autenticado (Fase 7 — transparência no dashboard).
 * Resposta: { percent, source: 'override' | 'tabela' | 'default' }
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  try {
    const { percent, source } = await getEffectiveCommissionPercent(user.id, user.role);
    return NextResponse.json({ percent, source });
  } catch (error) {
    console.error('[API dashboard/commission GET] Erro:', error);
    return NextResponse.json({ percent: 5, source: 'default' });
  }
}
