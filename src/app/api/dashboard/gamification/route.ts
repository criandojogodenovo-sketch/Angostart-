import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSellerStats } from '@/lib/gamification-server';
import { nextLevel, BADGE_META } from '@/lib/gamification';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/gamification — pontos, nível, progresso e selos do
 * utilizador autenticado (Fase 7). Usado no dashboard do vendedor e no perfil.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Entra na tua conta.' }, { status: 401 });
  }

  try {
    const stats = await getSellerStats(user.id);
    const progress = nextLevel(stats.points);

    return NextResponse.json({
      points: stats.points,
      level: stats.level,
      sales_count: stats.sales_count,
      badges: stats.badges,
      next_level: progress.next ? { key: progress.next.key, label: progress.next.label, missing: progress.missing } : null,
      progress, // 0–1 dentro do nível atual
      // Selos ainda não conquistados (mostrados a cinzento — motivação)
      locked_badges: Object.entries(BADGE_META)
        .filter(([code]) => !stats.badges.some((b) => b.code === code))
        .map(([code, meta]) => ({ code, ...meta })),
    });
  } catch (error) {
    console.error('[API dashboard/gamification GET] Erro:', error);
    return NextResponse.json(
      { points: 0, level: 'bronze', badges: [], next_level: null, progress: 0, locked_badges: [] },
      { status: 200 }
    );
  }
}
