import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/users — lista todos os utilizadores (painel /admin).
 * 🔒 Apenas role='admin' (2FA já validada por cookie + Bearer admin).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const users = (await sql`
      SELECT id, name, email, role, username, cidade, blocked::boolean,
             two_factor_enabled::boolean, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 500
    `) as unknown as Record<string, unknown>[];

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[API admin/users] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível listar os utilizadores.' }, { status: 503 });
  }
}
