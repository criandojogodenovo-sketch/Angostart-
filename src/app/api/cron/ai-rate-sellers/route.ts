import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { rateSeller } from '@/lib/ai-seller';
import { aiAvailable } from '@/lib/ai/chat';

export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/cron/ai-rate-sellers — Fase 14: batch diário que avalia a
 * bio de todos os vendedores ativos com a IA da Groq (grátis) e guarda a
 * nota 0-10 em users.ai_seller_rating (destaque em /prestadores e /lojas).
 *
 * - 🔒 Proteção: `Authorization: Bearer $CRON_SECRET` (padrão dos crons).
 * - PARALELO com concorrência 3 + pausa entre lotes (respeita o rate limit
 *   do tier gratuito; 14.400 req/dia dá de sobra para centenas de vendedores).
 * - Idempotente: só reavalia quem nunca foi avaliado ou foi avaliado há
 *   mais de 7 dias; bios novas/alteradas são detetadas por ai_rated_at.
 * - Falha da IA num vendedor NUNCA aborta o lote — segue para o próximo.
 *
 * Agendamento: vercel.json → diário 05:15 UTC (depois do gamification 03:00
 * e do KYC 04:30, para escalonar os jobs).
 */

const CONCURRENCY = 3;
const PAUSE_MS = 400; // pausa entre lotes
const RE_EVALUATE_DAYS = 7;
const BATCH_LIMIT = 300; // teto de segurança por execução

interface SellerRow {
  id: number;
  name: string;
  role: string;
  bio: string;
}

function authorizeCron(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (cronSecret) {
    if (bearer !== cronSecret) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET não configurada — cron desativado em produção.' },
      { status: 403 }
    );
  }
  return null;
}

async function runRateSellers() {
  if (!aiAvailable()) {
    return { skipped: true, reason: 'Nenhum provider de IA configurado (ex.: OPENROUTER_API_KEY, GEMINI_API_KEY).', avaliados: 0 };
  }

  /* Vendedores ativos com bio analisável, nunca avaliados ou antigos. */
  const sellers = (await sql`
    SELECT id, name, role, COALESCE(bio, '') AS bio
      FROM users
     WHERE role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
       AND blocked = FALSE
       AND LENGTH(TRIM(COALESCE(bio, ''))) >= 10
       AND (ai_rated_at IS NULL OR ai_rated_at < NOW() - INTERVAL '7 days')
     ORDER BY ai_rated_at NULLS FIRST, id
     LIMIT ${BATCH_LIMIT}
  `) as unknown as SellerRow[];

  let avaliados = 0;
  let falhas = 0;
  let index = 0;

  /* Pool simples de concorrência fixa. */
  async function worker() {
    while (index < sellers.length) {
      const current = sellers[index++];
      if (!current) break;
      try {
        const result = await rateSeller(current.id, current.name, current.role, current.bio);
        if (result) avaliados += 1;
        else falhas += 1;
      } catch {
        falhas += 1;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, sellers.length) }, () => worker());
  await Promise.all(workers);
  if (index < sellers.length || avaliados + falhas < sellers.length) {
    /* pausa suave entre lotes quando houver mais a processar */
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return { skipped: false, total: sellers.length, avaliados, falhas };
}

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  try {
    const result = await runRateSellers();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[API cron/ai-rate-sellers] Erro no GET:', error);
    return NextResponse.json({ error: 'Falha no batch de avaliação.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  try {
    const result = await runRateSellers();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[API cron/ai-rate-sellers] Erro no POST:', error);
    return NextResponse.json({ error: 'Falha no batch de avaliação.' }, { status: 503 });
  }
}
