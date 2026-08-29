import 'server-only';
import { sql } from '@/lib/db';

/**
 * AngoStart — Afiliados (Fase A) — server-side.
 *
 * Código único por utilizador (ex.: AFG-3K9PQX), comissão automática de
 * 10% creditada na carteira quando a encomenda indicada é paga.
 */

export interface AffiliateRow {
  id: number;
  user_id: number;
  codigo_afiliado: string;
  comissao_percentual: number;
  created_at: string;
}

export interface AffiliateEarning {
  id: number;
  order_id: number;
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
    SELECT id, user_id, codigo_afiliado, comissao_percentual::float8, created_at
    FROM affiliates WHERE user_id = ${userId} LIMIT 1
  `) as unknown as AffiliateRow[];
  return rows[0] ?? null;
}

/**
 * Cria (ou devolve) o registo de afiliado do utilizador autenticado.
 * Idempotente — chamar 2× devolve o mesmo código.
 */
export async function getOrCreateAffiliate(userId: number): Promise<AffiliateRow> {
  const existing = await getAffiliateByUserId(userId);
  if (existing) return existing;

  const code = await generateAffiliateCode();
  const inserted = (await sql`
    INSERT INTO affiliates (user_id, codigo_afiliado, comissao_percentual)
    VALUES (${userId}, ${code}, 10.00)
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
    SELECT e.id, e.order_id, e.comissao::float8, e.percentual::float8, e.status, e.created_at
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
