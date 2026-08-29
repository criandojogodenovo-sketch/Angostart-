import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export interface AnnouncementRow {
  id: number;
  title: string;
  content: string;
  type: 'promo' | 'destaque' | 'novidade' | 'exclusivo';
  target_role: string | null;
  created_at: string;
}

const ANNOUNCEMENT_TYPES = ['promo', 'destaque', 'novidade', 'exclusivo'] as const;

/**
 * GET /api/announcements — anúncios ATIVOS visíveis ao utilizador atual.
 * - Sem sessão: apenas promo / destaque / novidade genéricos.
 * - Com sessão: + anúncios direcionados ao role do utilizador.
 * - 'exclusivo': apenas para admin (comunicação interna da equipa).
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'announcements-get'), 60, 60_000)) {
    return NextResponse.json({ announcements: [] });
  }

  const user = await getAuthUser(request);
  const role = user?.role ?? null;
  const isAdmin = role === 'admin';

  try {
    // Visibilidade:
    //  - anúncios genéricos (target_role NULL) → todos
    //  - anúncios direcionados → apenas o role de destino
    //  - 'exclusivo' → apenas admin total
    const rows = (await sql`
      SELECT id, title, content, type, target_role, created_at
      FROM announcements
      WHERE active = TRUE
        AND (type <> 'exclusivo' OR ${isAdmin})
        AND (target_role IS NULL OR target_role = ${role})
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `) as unknown as AnnouncementRow[];

    // Filtra tipos válidos (defesa contra dados inválidos)
    const announcements = rows.filter((r) =>
      (ANNOUNCEMENT_TYPES as readonly string[]).includes(r.type)
    );

    return NextResponse.json({ announcements });
  } catch (error) {
    console.error('[API announcements] Erro no GET:', error);
    return NextResponse.json({ announcements: [] });
  }
}
