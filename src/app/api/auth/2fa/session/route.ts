import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, ADMIN_COOKIE } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

/** GET /api/auth/2fa/session — o painel pergunta se há cookie admin válido. */
export async function GET(request: NextRequest) {
  const session = await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { authenticated: false, error: 'Sem sessão de administração. Faz login + 2FA.' },
      { status: 401 }
    );
  }
  return NextResponse.json({ authenticated: true, role: session.role });
}
