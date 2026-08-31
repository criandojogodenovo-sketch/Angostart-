import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { rateSeller } from '@/lib/ai-seller';
import { aiAvailable } from '@/lib/ai/chat';

export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/cron/ai-rate-sellers — Fase 14: batch diário que avalia a
 * bio de todos os vendedores ativos com a IA (B.AI/GLM-5.3-Flash grátis
 * como principal, com fallback multi-provider) e guarda a nota 0-10 em
 * users.ai_seller_rating (destaque em /prestadores e /lojas).
 *
 * - 🔒 Proteção: `Authorization: Bearer $CRON_SECRET` (padrão dos crons).
 * - RATE LIMITER (Fase 14c): o tier gratuito do B.AI não cobra tokens mas
 *   limita REQ/Min — o lote distribui os arranques num ritmo máximo de
 *   AI_RATE_PER_MIN análises/minuto (default 5; env para ajustar). Com
 *   concorrência 3, o pool partilha o mesmo ritmo (token bucket por tempo).
 * - ORÇAMENTO DE EXECUÇÃO: a função pára ao fim de AI_CRON_BUDGET_S
 *   segundos (default 55 — cabe no limite de 60 s do plano Hobby; em Pro
 *   podes pôr 290 para processar muito mais por execução). Quem ficar para
 *   trás fica na fila — a ordenação por ai_rated_at NULLS FIRST garante
 *   prioridade na execução seguinte.
 * - CACHE (Fase 14c): só reavalia quem nunca foi avaliado ou foi avaliado
 *   há mais de 7 dias (bem mais conservador que o mínimo de 24 h pedido —
 *   poupam-se requisições; bios novas/alteradas são detetadas por
 *   ai_rated_at).
 * - Falha da IA num vendedor NUNCA aborta o lote — segue para o próximo.
 *
 * Agendamento: vercel.json → diário 05:15 UTC (depois do gamification 03:00
 * e do KYC 04:30, para escalonar os jobs).
 */

export const maxDuration = 300; // Vercel limita ao máximo do plano (Hobby: 60 s)

const CONCURRENCY = 3;
const RE_EVALUATE_DAYS = 7;
const BATCH_LIMIT = 300; // teto de segurança por execução

/** Análises/minuto (token bucket por tempo de arranque, partilhado). */
function ratePerMin(): number {
  const n = Number(process.env.AI_RATE_PER_MIN);
  return Number.isFinite(n) && n >= 1 && n <= 120 ? Math.floor(n) : 5;
}

/** Orçamento de execução em ms (default 55 s; máx. 290 s). */
function runBudgetMs(): number {
  const n = Number(process.env.AI_CRON_BUDGET_S);
  const seconds = Number.isFinite(n) && n >= 5 && n <= 290 ? Math.floor(n) : 55;
  return seconds * 1000;
}

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
    return { skipped: true, reason: 'Nenhum provider de IA configurado (ex.: B_AI_API_KEY, OPENROUTER_API_KEY).', avaliados: 0 };
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

  /* ── Token bucket por TEMPO: o 1.º pedido arranca já; cada arranque
     seguinte espera o intervalo mínimo (60 s / rate). Partilhado pelo pool
     inteiro — o ritmo global respeita o limite do provider principal. ── */
  const minIntervalMs = Math.ceil(60_000 / ratePerMin());
  const runStart = Date.now();
  let nextSlotAt = runStart;

  /** Adquire um "slot" de arranque; false = orçamento esgotado (parar). */
  async function acquireSlot(): Promise<boolean> {
    const wait = nextSlotAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (Date.now() - runStart > runBudgetMs()) return false;
    nextSlotAt = Math.max(nextSlotAt, Date.now() - 1) + minIntervalMs;
    return true;
  }

  /* Pool simples de concorrência fixa com ritmo partilhado. */
  async function worker() {
    while (index < sellers.length) {
      const current = sellers[index++];
      if (!current) break;
      if (!(await acquireSlot())) {
        index -= 1; // devolve o vendedor à fila para a próxima execução
        return;
      }
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

  const processados = avaliados + falhas;
  return {
    skipped: false,
    total: sellers.length,
    avaliados,
    falhas,
    processados,
    pendentes: sellers.length - processados,
    ritmo_por_minuto: ratePerMin(),
  };
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
