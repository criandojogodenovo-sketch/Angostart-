import 'server-only';
import { sql } from '@/lib/db';
import { getBusinessConfig } from '@/lib/config';

/**
 * AngoStart — Afiliados (Fase A + Fase 5 + Fase 9) — server-side.
 *
 * Código único por utilizador (ex.: AFG-3K9PQX), comissão automática
 * creditada na carteira quando a encomenda indicada é paga. O percentual
 * de novos afiliados vem de AFFILIATE_COMMISSION_PERCENT (lib/config.ts,
 * default 10 %) — sem valores hardcoded.
 *
 * Fase 9 — regras de elegibilidade e escalões:
 *  - Vendedor/Prestador: ≥ 7 vendas concluídas (encomendas pagas).
 *  - Cliente: ≥ 2 compras concluídas (encomendas pagas).
 *  - Escalão automático: ≥ 50 comissões recebidas → 15 % (em vez de 10 %).
 */

/** Vendas pagas mínimas para vendedores aderirem ao programa. */
export const MIN_SALES_AFFILIATE = 7;
/** Compras pagas mínimas para clientes aderirem ao programa. */
export const MIN_PURCHASES_AFFILIATE = 2;
/** Comissões recebidas para subir para o escalão de 15 %. */
export const AFFILIATE_TIER_THRESHOLD = 50;
/** Percentual do escalão avançado. */
export const AFFILIATE_TIER_PERCENT = 15;

export interface AffiliateRow {
  id: number;
  user_id: number;
  codigo_afiliado: string;
  comissao_percentual: number;
  active: boolean;
  total_earnings: number;
  created_at: string;
}

export interface AffiliateEarning {
  id: number;
  order_id: number;
  product_id: number | null;
  comissao: number;
  percentual: number;
  status: string;
  created_at: string;
}

/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L, V/U). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';

function randomCodeFragment(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Gera um código único no formato AFG-XXXXXX (verifica colisão na BD). */
export async function generateAffiliateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `AFG-${randomCodeFragment(6)}`;
    const taken = (await sql`
      SELECT 1 FROM affiliates WHERE codigo_afiliado = ${code} LIMIT 1
    `) as unknown as { 1: number }[];
    if (taken.length === 0) return code;
  }
  // Improvável — 30^6 combinações; fallback com fragmento maior
  return `AFG-${randomCodeFragment(9)}`;
}

/** Devolve o registo de afiliado do utilizador (sem criar). */
export async function getAffiliateByUserId(
  userId: number
): Promise<AffiliateRow | null> {
  const rows = (await sql`
    SELECT id, user_id, codigo_afiliado, comissao_percentual::float8,
           active::boolean, total_earnings::float8, created_at
    FROM affiliates WHERE user_id = ${userId} LIMIT 1
  `) as unknown as AffiliateRow[];
  return rows[0] ?? null;
}

/* ─────────────── Elegibilidade (Fase 9, ponto 3A) ─────────────── */

export interface AffiliateEligibility {
  eligible: boolean;
  role: 'vendedor' | 'cliente';
  /** Vendas/compras concluídas (pagas). */
  count: number;
  required: number;
  message: string;
}

/**
 * Conta vendas concluídas do vendedor: encomendas com status `pago`
 * (ou mais avançado) em que tem itens próprios (items.seller_id).
 */
export async function countSellerPaidSales(userId: number): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(DISTINCT o.id)::int AS n
    FROM orders o,
         jsonb_array_elements(o.items) item
    WHERE (item->>'seller_id')::int = ${userId}
      AND o.status IN ('pago', 'entregue', 'concluido')
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Compras concluídas do cliente: encomendas pagas associadas à conta. */
export async function countBuyerPaidPurchases(userId: number): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM orders
    WHERE user_id = ${userId}
      AND status IN ('pago', 'entregue', 'concluido')
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Verifica se o utilizador cumpre o requisito mínimo para ser afiliado
 * (vendedor: 7 vendas · cliente: 2 compras). Nunca cria o afiliado.
 */
export async function getAffiliateEligibility(
  userId: number,
  isSeller: boolean
): Promise<AffiliateEligibility> {
  const role: 'vendedor' | 'cliente' = isSeller ? 'vendedor' : 'cliente';
  const required = isSeller ? MIN_SALES_AFFILIATE : MIN_PURCHASES_AFFILIATE;
  const count = isSeller
    ? await countSellerPaidSales(userId)
    : await countBuyerPaidPurchases(userId);

  const eligible = count >= required;
  return {
    eligible,
    role,
    count,
    required,
    message: eligible
      ? `Requisito cumprido: ${count} ${isSeller ? 'vendas' : 'compras'} concluídas.`
      : `Ainda não tens ${isSeller ? 'vendas' : 'compras'} suficientes para ser afiliado. Necessitas de ${required - count} ${isSeller ? 'vendas' : 'compras'}.`,
  };
}

/* ────────────────── Escalão automático (Fase 9, 3C) ───────────────── */

/** Comissões pagas recebidas pelo afiliado (para o escalão de 15 %). */
export async function countAffiliateEarnings(affiliateId: number): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM affiliate_earnings
    WHERE affiliate_id = ${affiliateId} AND status = 'pago'
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Percentual efetivo do afiliado: sobe para 15 % após 50 comissões
 * recebidas (escalão automático) — atualiza o registo na BD.
 */
export async function resolveAffiliatePercent(
  affiliate: Pick<AffiliateRow, 'id' | 'comissao_percentual'>
): Promise<number> {
  const current = Number(affiliate.comissao_percentual);
  if (current >= AFFILIATE_TIER_PERCENT) return current;
  const recebidas = await countAffiliateEarnings(affiliate.id);
  if (recebidas >= AFFILIATE_TIER_THRESHOLD) {
    await sql`
      UPDATE affiliates
      SET comissao_percentual = ${AFFILIATE_TIER_PERCENT}, updated_at = NOW()
      WHERE id = ${affiliate.id}
    `;
    return AFFILIATE_TIER_PERCENT;
  }
  return current;
}

/**
 * Cria (ou devolve) o registo de afiliado do utilizador autenticado.
 * Idempotente — chamar 2× devolve o mesmo código. O percentual inicial
 * vem da configuração central (AFFILIATE_COMMISSION_PERCENT).
 */
export async function getOrCreateAffiliate(userId: number): Promise<AffiliateRow> {
  const existing = await getAffiliateByUserId(userId);
  if (existing) return existing;

  const code = await generateAffiliateCode();
  const percent = getBusinessConfig().affiliateCommissionPercent;
  const inserted = (await sql`
    INSERT INTO affiliates (user_id, codigo_afiliado, comissao_percentual)
    VALUES (${userId}, ${code}, ${percent})
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id, user_id, codigo_afiliado, comissao_percentual::float8, created_at
  `) as unknown as AffiliateRow[];

  if (inserted[0]) return inserted[0];
  const race = await getAffiliateByUserId(userId);
  if (!race) throw new Error('Não foi possível criar o código de afiliado.');
  return race;
}

/** Comissões do afiliado + totais (para o dashboard). */
export async function listAffiliateEarnings(
  affiliateId: number,
  limit = 25
): Promise<{ earnings: AffiliateEarning[]; total: number }> {
  const rows = (await sql`
    SELECT e.id, e.order_id, e.product_id, e.comissao::float8, e.percentual::float8, e.status, e.created_at
    FROM affiliate_earnings e
    WHERE e.affiliate_id = ${affiliateId}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${limit}
  `) as unknown as AffiliateEarning[];

  const totals = (await sql`
    SELECT COALESCE(SUM(comissao), 0)::float8 AS total
    FROM affiliate_earnings
    WHERE affiliate_id = ${affiliateId} AND status = 'pago'
  `) as unknown as { total: number }[];

  return {
    earnings: rows.map((r) => ({
      ...r,
      comissao: Number(r.comissao),
      percentual: Number(r.percentual),
    })),
    total: Number(totals[0]?.total ?? 0),
  };
}
