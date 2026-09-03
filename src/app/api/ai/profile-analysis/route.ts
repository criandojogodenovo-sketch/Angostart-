import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import { aiAvailable } from '@/lib/ai/chat';
import { consumeDailyQuota, remainingQuota } from '@/lib/ai/usage';
import { analyzeMyProfile } from '@/lib/ai-profile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/ai/profile-analysis — Fase 21: «Analisar o meu perfil com IA».
 *
 * - 🔒 Utilizador autenticado — cada vendedor analisa o SEU perfil
 *   (bio + produtos/keywords + avaliações); nunca o de outro.
 * - Tarefa 'chat' (MiMo-V2.5) — feature de utilizador.
 * - Quota: 3 análises/dia por utilizador (anti-abuso da API gratuita).
 * - GET devolve o saldo de análises de hoje (para a UI desativar o botão).
 *
 * Resposta: { nota, resumo, pontos_fortes[], pontos_a_melhorar[] }.
 */

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  const restantes = await remainingQuota(user.id, 'profile_analyses');
  return NextResponse.json({ restantes, limite_dia: 3 });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `profile-ai-u${user.id}`), 5, 60_000)) {
    return NextResponse.json(
      { error: 'Aguarda um momento antes de analisar de novo.' },
      { status: 429 }
    );
  }
  if (!aiAvailable()) {
    return NextResponse.json(
      {
        error:
          'A análise por IA está temporariamente indisponível. Tenta mais tarde.',
        code: 'AI_UNAVAILABLE',
      },
      { status: 503 }
    );
  }

  const okQuota = await consumeDailyQuota(user.id, 'profile_analyses');
  if (!okQuota) {
    return NextResponse.json(
      {
        error:
          'Alcançaste o limite de 3 análises hoje. Tenta novamente amanhã.',
        code: 'QUOTA_EXCEEDED',
      },
      { status: 429 }
    );
  }

  const analysis = await analyzeMyProfile(user.id);
  if (!analysis) {
    return NextResponse.json(
      {
        error:
          'Não foi possível analisar agora. Se o teu perfil ainda não tem bio escrita, começa por preenchê-la e tenta de novo.',
        code: 'ANALYSIS_FAILED',
      },
      { status: 502 }
    );
  }

  return NextResponse.json(analysis);
}
