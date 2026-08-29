import 'server-only';
import { sql } from '@/lib/db';
import { getBusinessConfig, commissionPercentForRole } from '@/lib/config';

/**
 * AngoStart — Comissões flexíveis (Fase 7) — server-only.
 *
 * Precedência da taxa aplicada a uma venda:
 *   1. `seller_commission_overrides` — taxa individual do vendedor (admin)
 *   2. `commission_rates`            — taxa por tipo (produto/domicílio/freelancer)
 *   3. Defaults/env de `lib/config.ts` — fallback seguro
 *
 * Auditoria: TODA a alteração de taxas fica em `commission_audit`
 * (admin, escopo, valor antigo, valor novo). Máximo permitido: 50 %.
 */

export const COMMISSION_SCOPES = ['produto', 'servico_domicilio', 'freelancer'] as const;
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];
export const MAX_COMMISSION_PERCENT = 50;

export function scopeForRole(role: string | null | undefined): CommissionScope {
  switch (role) {
    case 'prestador_domicilio':
      return 'servico_domicilio';
    case 'prestador_remoto':
      return 'freelancer';
    default:
      return 'produto';
  }
}

export function validScope(scope: unknown): scope is CommissionScope {
  return typeof scope === 'string' && (COMMISSION_SCOPES as readonly string[]).includes(scope);
}

function clampPercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COMMISSION_PERCENT) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Taxa EFETIVA de comissão (%) para um vendedor — usada no escrow quando
 * o pedido é pago. Ordem: override individual > taxa por tipo > default.
 */
export async function getEffectiveCommissionPercent(
  sellerId: number,
  role: string | null | undefined
): Promise<{ percent: number; source: 'override' | 'tabela' | 'default' }> {
  try {
    const overrideRows = (await sql`
      SELECT percent::float8 AS percent
      FROM seller_commission_overrides
      WHERE user_id = ${sellerId} LIMIT 1
    `) as unknown as { percent: number }[];
    if (overrideRows[0]) {
      return { percent: Number(overrideRows[0].percent), source: 'override' };
    }

    const scope = scopeForRole(role);
    const rateRows = (await sql`
      SELECT percent::float8 AS percent FROM commission_rates
      WHERE scope = ${scope} LIMIT 1
    `) as unknown as { percent: number }[];
    if (rateRows[0]) {
      return { percent: Number(rateRows[0].percent), source: 'tabela' };
    }
  } catch (error) {
    console.error('[commissions] Falha ao ler taxas — uso o default:', error);
  }

  return { percent: commissionPercentForRole(role, getBusinessConfig()), source: 'default' };
}

/* ───────────────────────── Escrita (admin) ───────────────────────────── */

/** Define a taxa por tipo de produto/serviço. Auditoria incluída. */
export async function setCommissionRate(
  adminId: number,
  scope: CommissionScope,
  percent: unknown
): Promise<{ ok: true; percent: number } | { ok: false; error: string }> {
  const value = clampPercent(percent);
  if (value === null) {
    return { ok: false, error: `A taxa deve estar entre 0 e ${MAX_COMMISSION_PERCENT}%.` };
  }

  const old = (await sql`
    SELECT percent::float8 AS percent FROM commission_rates WHERE scope = ${scope} LIMIT 1
  `) as unknown as { percent: number }[];
  const oldPercent = old[0]?.percent ?? null;

  await sql`
    INSERT INTO commission_rates (scope, percent, updated_at)
    VALUES (${scope}, ${value}, now())
    ON CONFLICT (scope) DO UPDATE SET percent = ${value}, updated_at = now()
  `;
  await sql`
    INSERT INTO commission_audit (admin_id, scope, seller_id, old_percent, new_percent)
    VALUES (${adminId}, ${scope}, NULL, ${oldPercent}, ${value})
  `;
  return { ok: true, percent: value };
}

/** Define (ou remove, com percent = null) a taxa individual de um vendedor. */
export async function setSellerOverride(
  adminId: number,
  sellerId: number,
  percent: unknown
): Promise<{ ok: true; percent: number | null } | { ok: false; error: string }> {
  if (!Number.isInteger(sellerId) || sellerId <= 0) {
    return { ok: false, error: 'Vendedor inválido.' };
  }

  const exists = (await sql`
    SELECT 1 FROM users WHERE id = ${sellerId} LIMIT 1
  `) as unknown as Record<string, unknown>[];
  if (!exists[0]) return { ok: false, error: 'Vendedor não encontrado.' };

  // percent null = remover override (volta à taxa geral)
  if (percent === null || percent === '') {
    const old = (await sql`
      SELECT percent::float8 AS percent FROM seller_commission_overrides
      WHERE user_id = ${sellerId} LIMIT 1
    `) as unknown as { percent: number }[];
    await sql`DELETE FROM seller_commission_overrides WHERE user_id = ${sellerId}`;
    await sql`
      INSERT INTO commission_audit (admin_id, scope, seller_id, old_percent, new_percent)
      VALUES (${adminId}, 'override', ${sellerId}, ${old[0]?.percent ?? null}, -1)
    `; // -1 = removido
    return { ok: true, percent: null };
  }

  const value = clampPercent(percent);
  if (value === null) {
    return { ok: false, error: `A taxa deve estar entre 0 e ${MAX_COMMISSION_PERCENT}%.` };
  }

  const old = (await sql`
    SELECT percent::float8 AS percent FROM seller_commission_overrides
    WHERE user_id = ${sellerId} LIMIT 1
  `) as unknown as { percent: number }[];

  await sql`
    INSERT INTO seller_commission_overrides (user_id, percent, updated_by, updated_at)
    VALUES (${sellerId}, ${value}, ${adminId}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET percent = ${value}, updated_by = ${adminId}, updated_at = now()
  `;
  await sql`
    INSERT INTO commission_audit (admin_id, scope, seller_id, old_percent, new_percent)
    VALUES (${adminId}, 'override', ${sellerId}, ${old[0]?.percent ?? null}, ${value})
  `;
  return { ok: true, percent: value };
}

/* ───────────────────────── Leitura (painel admin) ───────────────────── */

export interface CommissionOverview {
  rates: { scope: CommissionScope; percent: number; updated_at: string }[];
  overrides: {
    user_id: number;
    name: string | null;
    email: string | null;
    percent: number;
    updated_at: string;
  }[];
  audit: {
    id: number;
    admin_name: string | null;
    scope: string;
    seller_id: number | null;
    seller_name: string | null;
    old_percent: number | null;
    new_percent: number;
    created_at: string;
  }[];
  report: {
    por_categoria: { categoria: string; vendas: number; receita: number; comissao: number }[];
    por_mes: { mes: string; comissao: number }[];
    total_comissoes: number;
  };
}

/** Dados completos para a secção «Comissões» do painel admin. */
export async function getCommissionOverview(): Promise<CommissionOverview> {
  const rates = (await sql`
    SELECT scope, percent::float8 AS percent, updated_at FROM commission_rates ORDER BY scope
  `) as unknown as Record<string, unknown>[];

  const overrides = (await sql`
    SELECT o.user_id, u.name, u.email, o.percent::float8 AS percent, o.updated_at
    FROM seller_commission_overrides o
    LEFT JOIN users u ON u.id = o.user_id
    ORDER BY o.updated_at DESC LIMIT 100
  `) as unknown as Record<string, unknown>[];

  const audit = (await sql`
    SELECT a.id, a.scope, a.seller_id, a.old_percent::float8 AS old_percent,
           a.new_percent::float8 AS new_percent, a.created_at,
           ad.name AS admin_name, s.name AS seller_name
    FROM commission_audit a
    LEFT JOIN users ad ON ad.id = a.admin_id
    LEFT JOIN users s ON s.id = a.seller_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT 50
  `) as unknown as Record<string, unknown>[];

  // Relatório: comissões retidas por categoria (role do vendedor) e por mês
  const porCategoria = (await sql`
    SELECT COALESCE(u.role, 'criador') AS categoria,
           count(DISTINCT t.order_id)::int AS vendas,
           SUM(CASE WHEN t.tipo = 'recebimento' THEN t.valor ELSE 0 END)::float8 AS receita,
           SUM(t.commission_kz)::float8 AS comissao
    FROM wallet_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.tipo = 'recebimento' AND t.commission_kz > 0
    GROUP BY 1 ORDER BY comissao DESC
  `) as unknown as Record<string, unknown>[];

  const porMes = (await sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
           SUM(commission_kz)::float8 AS comissao
    FROM wallet_transactions
    WHERE tipo = 'recebimento' AND commission_kz > 0
      AND created_at >= date_trunc('month', now()) - interval '11 months'
    GROUP BY 1 ORDER BY 1
  `) as unknown as Record<string, unknown>[];

  const total = (await sql`
    SELECT COALESCE(SUM(commission_kz), 0)::float8 AS total
    FROM wallet_transactions WHERE tipo = 'recebimento' AND commission_kz > 0
  `) as unknown as { total: number }[];

  return {
    rates: rates.map((r) => ({
      scope: String(r.scope) as CommissionScope,
      percent: Number(r.percent),
      updated_at: String(r.updated_at),
    })),
    overrides: overrides.map((o) => ({
      user_id: Number(o.user_id),
      name: (o.name as string) ?? null,
      email: (o.email as string) ?? null,
      percent: Number(o.percent),
      updated_at: String(o.updated_at),
    })),
    audit: audit.map((a) => ({
      id: Number(a.id),
      admin_name: (a.admin_name as string) ?? null,
      scope: String(a.scope),
      seller_id: a.seller_id === null || a.seller_id === undefined ? null : Number(a.seller_id),
      seller_name: (a.seller_name as string) ?? null,
      old_percent: a.old_percent === null || a.old_percent === undefined ? null : Number(a.old_percent),
      new_percent: Number(a.new_percent),
      created_at: String(a.created_at),
    })),
    report: {
      por_categoria: porCategoria.map((c) => ({
        categoria: String(c.categoria),
        vendas: Number(c.vendas ?? 0),
        receita: Number(c.receita ?? 0),
        comissao: Number(c.comissao ?? 0),
      })),
      por_mes: porMes.map((m) => ({
        mes: String(m.mes),
        comissao: Number(m.comissao ?? 0),
      })),
      total_comissoes: Number(total[0]?.total ?? 0),
    },
  };
}
