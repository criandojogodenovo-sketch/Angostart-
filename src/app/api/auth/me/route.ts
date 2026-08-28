import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 * Devolve { user } com os dados atuais da sessão (usado para restaurar
 * a sessão quando a app carrega).
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Entra novamente.' },
      { status: 401 }
    );
  }

  return NextResponse.json({ user });
}
