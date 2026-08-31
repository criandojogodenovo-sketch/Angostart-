import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import { requireAdmin, clientKey, rateLimit, sanitizeText } from '@/lib/security';
import { aiAvailable } from '@/lib/ai/chat';
import { analyzeSellerBio, saveSellerRating, type SellerRatingResult } from '@/lib/ai-seller';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/review-seller — Fase 14: nota de qualidade do perfil (0-10)
 * pela IA da Groq (llama-3.1-8b-instant), com justificativa e sugestões.
 *
 * Dois modos:
 *  1. { bio, role?, name? }        → qualquer utilizador autenticado analisa
 *     um TEXTO (pré-visualização / teste; NÃO grava). 6 req/min.
 *  2. { user_id } (apenas Admin)   → carrega a bio do vendedor na BD,
 *     analisa e GRAVA em users.ai_seller_rating (+summary, +rated_at).
 *
 * O cron diário (/api/cron/ai-rate-sellers) usa lib/ai-seller diretamente —
 * este endpoint é para uso interativo (painel admin / testes).
 */

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request).catch(() => null);
  if (!auth) {
    return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `ai-review-u${auth.id}`), 6, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas análises seguidas — aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: { bio?: unknown; role?: unknown; name?: unknown; user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  /* ── Modo 2: admin avalia (e grava) um vendedor específico ── */
  if (body.user_id !== undefined) {
    const admin = await requireAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }
    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: 'Vendedor inválido.' }, { status: 400 });
    }

    const rows = (await sql`
      SELECT id, name, role, COALESCE(bio, '') AS bio
        FROM users WHERE id = ${userId} LIMIT 1
    `) as unknown as { id: number; name: string; role: string; bio: string }[];
    const seller = rows[0];
    if (!seller || !isSellerRole(seller.role)) {
      return NextResponse.json({ error: 'Vendedor não encontrado.' }, { status: 404 });
    }
    if (seller.bio.trim().length < 10) {
      return NextResponse.json(
        { error: 'Este vendedor ainda não tem bio suficiente para analisar.' },
        { status: 400 }
      );
    }

    const result = await analyzeSellerBio(seller.name, seller.role, seller.bio);
    if (!result) {
      return NextResponse.json(
        { error: 'A IA não conseguiu analisar esta bio agora (sem chave ou resposta inválida).', code: 'AI_UNAVAILABLE' },
        { status: 502 }
      );
    }
    await saveSellerRating(userId, result);
    return NextResponse.json({ ok: true, saved: true, user_id: userId, ...result });
  }

  /* ── Modo 1: análise de texto livre (não grava) ── */
  const bio = sanitizeText(typeof body.bio === 'string' ? body.bio : '', 1200);
  if (bio.trim().length < 10) {
    return NextResponse.json(
      { error: 'Escreve uma bio com pelo menos 10 caracteres para analisar.' },
      { status: 400 }
    );
  }
  const role = sanitizeText(typeof body.role === 'string' ? body.role : 'criador', 40);
  const name = sanitizeText(typeof body.name === 'string' ? body.name : 'Vendedor', 80);

  if (!aiAvailable()) {
    return NextResponse.json(
      { error: 'Análise por IA temporariamente indisponível.', code: 'AI_UNAVAILABLE' },
      { status: 503 }
    );
  }

  const result: SellerRatingResult | null = await analyzeSellerBio(name, role, bio);
  if (!result) {
    return NextResponse.json(
      { error: 'A IA não conseguiu analisar esta bio agora (ou contém conteúdo bloqueado).' },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, saved: false, ...result });
}
