import 'server-only';
import { sql } from '@/lib/db';
import { BADGE_META, POINTS_RULES } from '@/lib/gamification';

/**
 * AngoStart — Gamificação no SERVIDOR (Fase 7).
 *
 * 🔒 server-only: pontos e selos são atribuídos automaticamente pelo
 * servidor (nunca pelo cliente). Todas as escritas são idempotentes.
 */

export interface SellerStats {
  points: number;
  level: string;
  sales_count: number;
  badges: { code: string; name: string; description: string; icon: string; awarded_at: string }[];
}

/** Adiciona pontos a um vendedor (upsert idempotente). */
export async function awardPoints(userId: number, amount: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0 || amount <= 0) return;
  try {
    await sql`
      INSERT INTO seller_points (user_id, points, updated_at)
      VALUES (${userId}, ${amount}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET points = seller_points.points + ${amount}, updated_at = now()
    `;
  } catch (error) {
    console.error('[gamification] awardPoints falhou:', error);
  }
}

/** Atribui um selo se ainda não existir. Devolve true se foi atribuído agora. */
async function awardBadgeOnce(userId: number, code: string): Promise<boolean> {
  const inserted = (await sql`
    INSERT INTO user_badges (user_id, badge_id)
    SELECT ${userId}, b.id FROM badges b WHERE b.code = ${code}
    ON CONFLICT (user_id, badge_id) DO NOTHING
    RETURNING id
  `) as unknown as { id: number }[];
  return Boolean(inserted[0]);
}

/**
 * Avalia TODOS os critérios automáticos de selos para um utilizador e
 * atribui os que faltam. Devolve os códigos atribuídos nesta chamada.
 */
export async function evaluateBadges(userId: number): Promise<string[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const awarded: string[] = [];

  try {
    // Vendas concluídas (encomendas pagas/entregues com itens do vendedor)
    const sales = (await sql`
      SELECT count(DISTINCT o.id)::int AS n
      FROM orders o, jsonb_array_elements(o.items) item
      WHERE o.status IN ('pago', 'entregue')
        AND (item->>'seller_id')::int = ${userId}
    `) as unknown as { n: number }[];
    const salesCount = Number(sales[0]?.n ?? 0);

    if (salesCount >= 1 && (await awardBadgeOnce(userId, 'primeira_venda'))) awarded.push('primeira_venda');
    if (salesCount >= 100 && (await awardBadgeOnce(userId, 'vendas_100'))) awarded.push('vendas_100');

    // Avaliações recebidas (média ≥ 4.8 com ≥ 10)
    const ratings = (await sql`
      SELECT COALESCE(AVG(r.rating)::float8, 0) AS avg, count(*)::int AS n
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      WHERE p.user_id = ${userId}
    `) as unknown as { avg: number; n: number }[];
    if (Number(ratings[0]?.n ?? 0) >= 10 && Number(ratings[0]?.avg ?? 0) >= 4.8) {
      if (await awardBadgeOnce(userId, 'avaliacao_5')) awarded.push('avaliacao_5');
    }

    // Infoprodutos publicados (≥ 5)
    const infos = (await sql`
      SELECT count(*)::int AS n FROM products
      WHERE user_id = ${userId} AND type = 'infoproduto'
    `) as unknown as { n: number }[];
    if (Number(infos[0]?.n ?? 0) >= 5 && (await awardBadgeOnce(userId, 'criador_infoprodutos'))) {
      awarded.push('criador_infoprodutos');
    }

    // Serviços ao domicílio concluídos (≥ 20)
    const domi = (await sql`
      SELECT count(DISTINCT o.id)::int AS n
      FROM orders o, jsonb_array_elements(o.items) item
      JOIN products p ON p.id = (item->>'id')::int
      WHERE o.status IN ('pago', 'entregue')
        AND (item->>'seller_id')::int = ${userId}
        AND p.type = 'servico_domicilio'
    `) as unknown as { n: number }[];
    if (Number(domi[0]?.n ?? 0) >= 20 && (await awardBadgeOnce(userId, 'prestador_domicilio'))) {
      awarded.push('prestador_domicilio');
    }

    // Projetos remotos concluídos (≥ 10)
    const remoto = (await sql`
      SELECT count(DISTINCT o.id)::int AS n
      FROM orders o, jsonb_array_elements(o.items) item
      JOIN products p ON p.id = (item->>'id')::int
      WHERE o.status IN ('pago', 'entregue')
        AND (item->>'seller_id')::int = ${userId}
        AND p.type = 'servico_remoto'
    `) as unknown as { n: number }[];
    if (Number(remoto[0]?.n ?? 0) >= 10 && (await awardBadgeOnce(userId, 'freelancer_top'))) {
      awarded.push('freelancer_top');
    }
  } catch (error) {
    console.error('[gamification] evaluateBadges falhou:', error);
  }

  return awarded;
}

/**
 * Pontos por resposta rápida ao chat (+10): chamado quando a resposta chega
 * menos de 1 h após a mensagem anterior do OUTRO participante. Guard: 1× por
 * conversa/dia/utilizador (anti-farm).
 */
export async function awardChatReplyPoints(
  conversationId: number,
  userId: number,
  replySeconds: number
): Promise<void> {
  if (replySeconds > 3600 || replySeconds < 0) return;
  try {
    const guard = (await sql`
      SELECT 1 FROM notifications
      WHERE user_id = ${userId}
        AND link = ${`/chat?c=${conversationId}`}
        AND title = '⚡ Resposta rápida (+10 pontos)'
        AND created_at >= date_trunc('day', now())
      LIMIT 1
    `) as unknown as Record<string, unknown>[];
    if (guard.length > 0) return; // já pontuou hoje nesta conversa

    await awardPoints(userId, POINTS_RULES.respostaRapida);
    const { pushNotification } = await import('@/lib/notifications');
    await pushNotification(
      userId,
      '⚡ Resposta rápida (+10 pontos)',
      'Respondes-te em menos de 1 hora — ganhaste 10 pontos!',
      `/chat?c=${conversationId}`
    );
  } catch (error) {
    console.error('[gamification] awardChatReplyPoints falhou:', error);
  }
}

/** Estatísticas completas do vendedor (pontos, nível, selos). */
export async function getSellerStats(userId: number): Promise<SellerStats> {
  const stats = (await sql`
    SELECT points::int, sales_count::int FROM seller_points WHERE user_id = ${userId} LIMIT 1
  `) as unknown as { points: number; sales_count: number }[];

  const badges = (await sql`
    SELECT b.code, b.name, b.description, b.icon, ub.awarded_at
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ${userId}
    ORDER BY ub.awarded_at DESC
  `) as unknown as Record<string, unknown>[];

  const { levelFor } = await import('@/lib/gamification');
  const points = Number(stats[0]?.points ?? 0);

  return {
    points,
    level: levelFor(points).key,
    sales_count: Number(stats[0]?.sales_count ?? 0),
    badges: badges.map((b) => ({
      code: String(b.code),
      name: String(b.name),
      description: String(b.description),
      icon: String(b.icon),
      awarded_at: String(b.awarded_at),
    })),
  };
}

/**
 * Cron diário — reavalia selos de todos os vendedores com atividade e o
 * «Top Vendedor do Mês» (no 1.º dia de cada mês, receita líquida do mês anterior).
 * Devolve { avaliados, atribuidos }.
 */
export async function runGamificationCron(): Promise<{
  avaliados: number;
  atribuidos: { user_id: number; badges: string[] }[];
}> {
  const sellers = (await sql`
    SELECT DISTINCT (item->>'seller_id')::int AS seller_id
    FROM orders o, jsonb_array_elements(o.items) item
    WHERE o.status IN ('pago', 'entregue') AND (item->>'seller_id')::int > 0
    UNION
    SELECT user_id FROM seller_points
  `) as unknown as { seller_id: number }[];

  const atribuidos: { user_id: number; badges: string[] }[] = [];

  for (const row of sellers) {
    const sellerId = Number(row.seller_id);
    // Mantém a contagem de vendas atualizada (cache dos pontos)
    const sales = (await sql`
      SELECT count(DISTINCT o.id)::int AS n
      FROM orders o, jsonb_array_elements(o.items) item
      WHERE o.status IN ('pago', 'entregue') AND (item->>'seller_id')::int = ${sellerId}
    `) as unknown as { n: number }[];
    await sql`
      INSERT INTO seller_points (user_id, sales_count, updated_at)
      VALUES (${sellerId}, ${Number(sales[0]?.n ?? 0)}, now())
      ON CONFLICT (user_id) DO UPDATE SET sales_count = ${Number(sales[0]?.n ?? 0)}, updated_at = now()
    `;

    const badges = await evaluateBadges(sellerId);

    // Top vendedor do mês: só no 1.º dia do mês, para o vencedor anterior
    if (new Date().getUTCDate() === 1) {
      const top = (await sql`
        SELECT (item->>'seller_id')::int AS seller_id,
               SUM(((item->>'price_kz')::numeric * (item->>'quantity')::numeric)) AS receita
        FROM orders o, jsonb_array_elements(o.items) item
        WHERE o.status IN ('pago', 'entregue')
          AND o.created_at >= date_trunc('month', now()) - interval '1 month'
          AND o.created_at < date_trunc('month', now())
        GROUP BY 1
        ORDER BY receita DESC
        LIMIT 1
      `) as unknown as { seller_id: number }[];
      if (Number(top[0]?.seller_id) === sellerId) {
        if (await awardBadgeOnce(sellerId, 'top_vendedor_mes')) badges.push('top_vendedor_mes');
      }
    }

    if (badges.length > 0) atribuidos.push({ user_id: sellerId, badges });
  }

  return { avaliados: sellers.length, atribuidos };
}

/** Garante que os metadados importados são usados (anti-lint em BADGE_META). */
export function badgeInfo(code: string) {
  return BADGE_META[code] ?? null;
}
