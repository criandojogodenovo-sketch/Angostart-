import 'server-only';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';

/**
 * GOMBUONE (evolução da AngoStart) — Motor de campanhas e oportunidades.
 *
 * Estrutura conceptual (integrada na arquitetura existente):
 *
 *   EMPRESA (vendedor/users) → CAMPANHA → OPORTUNIDADE (oferta/missão)
 *   → DISTRIBUIÇÃO (partilha com refCode AFG-XXXXXX existente + sub_id)
 *   → CONSUMIDOR (identidade anónima por cookie httpOnly — NUNCA IP)
 *   → CÓDIGO DE REDEMPTION (GMB-XXXXXX, imprevisível, único)
 *   → VALIDAÇÃO (atómica, pelo dono da campanha)
 *   → RESULTADOS/MÉTRICAS (por campanha, oportunidade e canal)
 *
 * Reutilização deliberada:
 *  - dono da campanha = vendedor (users), como products.user_id / stores.owner_id;
 *  - atribuição de distribuição = sistema de afiliados existente (AFG-XXXXXX)
 *    capturado pelo RefCapture (?ref=&sub=, 30 dias);
 *  - validação SQL atómica (UPDATE … WHERE status='emitido') como o fluxo
 *    de encomendas existente.
 */

/* ─────────────────────────── Tipos ─────────────────────────── */

export interface CampaignRow {
  id: number;
  owner_id: number;
  title: string;
  description: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus = 'rascunho' | 'ativa' | 'pausada' | 'terminada';
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'rascunho',
  'ativa',
  'pausada',
  'terminada',
];

export type OpportunityKind = 'oferta' | 'desconto' | 'missao' | 'brinde' | 'evento';
export const OPPORTUNITY_KINDS: readonly OpportunityKind[] = [
  'oferta',
  'desconto',
  'missao',
  'brinde',
  'evento',
];

export type OpportunityStatus = 'ativa' | 'pausada' | 'esgotada' | 'terminada';
export const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = [
  'ativa',
  'pausada',
  'esgotada',
  'terminada',
];

export interface OpportunityRow {
  id: number;
  campaign_id: number;
  title: string;
  description: string | null;
  kind: OpportunityKind;
  discount_percent: number | null;
  mission_text: string | null;
  total_codes: number;
  max_claims_per_consumer: number;
  code_ttl_hours: number;
  status: OpportunityStatus;
  created_at: string;
  updated_at: string;
}

export interface RedemptionCodeRow {
  id: number;
  opportunity_id: number;
  code: string;
  anon_id: string;
  user_id: number | null;
  ref_affiliate_id: number | null;
  sub_id: string | null;
  status: 'emitido' | 'utilizado' | 'expirado' | 'invalidado';
  claimed_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: number | null;
}

/* ─────────────────── Cookie de identidade anónima ─────────────────── */

/**
 * Cookie httpOnly que preserva a identidade anónima do consumidor entre
 * visitas (para idempotência do claim). NÃO é PII; NUNCA usamos IP como
 * identidade (IP apenas para rate limit/auditoria, via security.ts).
 */
export const ANON_COOKIE = 'gombuone_anon';
const ANON_COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // 180 dias

/** Lê (ou gera) o identificador anónimo do consumidor. */
export function getOrCreateAnonId(request: NextRequest): { anonId: string; isNew: boolean } {
  const existing = request.cookies.get(ANON_COOKIE)?.value;
  if (existing && /^[a-f0-9-]{16,64}$/i.test(existing)) {
    return { anonId: existing, isNew: false };
  }
  // UUID v4 criptograficamente aleatório (crypto.randomUUID)
  const anonId = crypto.randomUUID();
  return { anonId, isNew: true };
}

/** Opções do cookie anónimo (httpOnly, SameSite=Lax; Secure em produção). */
export function anonCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ANON_COOKIE_MAX_AGE,
  };
}

/* ────────────────── Códigos de redemption (GMB-XXXXXX) ────────────────── */

/** Alfabeto sem caracteres ambíguos (igual filosofia do AFG-XXXXXX). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
export const REDEMPTION_CODE_PREFIX = 'GMB';

/**
 * Gera um código único no formato GMB-XXXXXX.
 * ⚠️ Usa crypto.randomInt (CSPRNG) — imprevisível por exigência de
 * segurança (não Math.random). Verifica colisão na BD.
 */
export async function generateRedemptionCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `${REDEMPTION_CODE_PREFIX}-${randomFragment(6)}`;
    const taken = (await sql`
      SELECT 1 FROM redemption_codes WHERE code = ${code} LIMIT 1
    `) as unknown as { 1: number }[];
    if (taken.length === 0) return code;
  }
  // Extremamente improvável (31^6 combinações); fallback com fragmento maior
  return `${REDEMPTION_CODE_PREFIX}-${randomFragment(9)}`;
}

function randomFragment(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/* ───────────────────────── Campanhas ───────────────────────── */

export interface CampaignWithStats extends CampaignRow {
  owner_name: string;
  opportunity_count: number;
  codes_issued: number;
  codes_used: number;
}

/** Lista campanhas públicas ativas (com contadores) — página /campanhas. */
export async function listPublicCampaigns(limit = 60): Promise<CampaignWithStats[]> {
  const rows = (await sql`
    SELECT c.id, c.owner_id, c.title, c.description, c.status, c.starts_at, c.ends_at,
           c.created_at, c.updated_at,
           u.name AS owner_name,
           (SELECT COUNT(*)::int FROM opportunities o WHERE o.campaign_id = c.id
              AND o.status IN ('ativa', 'pausada')) AS opportunity_count,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o2 ON o2.id = r.opportunity_id
             WHERE o2.campaign_id = c.id) AS codes_issued,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o3 ON o3.id = r.opportunity_id
             WHERE o3.campaign_id = c.id AND r.status = 'utilizado') AS codes_used
      FROM campaigns c
      JOIN users u ON u.id = c.owner_id
     WHERE c.status IN ('ativa', 'pausada') AND u.blocked = FALSE
     ORDER BY c.created_at DESC
     LIMIT ${limit}
  `) as unknown as CampaignWithStats[];
  return rows;
}

/** Lista as campanhas do vendedor autenticado (todas, incluindo rascunhos). */
export async function listMyCampaigns(ownerId: number): Promise<CampaignWithStats[]> {
  const rows = (await sql`
    SELECT c.id, c.owner_id, c.title, c.description, c.status, c.starts_at, c.ends_at,
           c.created_at, c.updated_at,
           u.name AS owner_name,
           (SELECT COUNT(*)::int FROM opportunities o WHERE o.campaign_id = c.id) AS opportunity_count,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o2 ON o2.id = r.opportunity_id
             WHERE o2.campaign_id = c.id) AS codes_issued,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o3 ON o3.id = r.opportunity_id
             WHERE o3.campaign_id = c.id AND r.status = 'utilizado') AS codes_used
      FROM campaigns c
      JOIN users u ON u.id = c.owner_id
     WHERE c.owner_id = ${ownerId}
     ORDER BY c.created_at DESC
  `) as unknown as CampaignWithStats[];
  return rows;
}

/** Devolve uma campanha (null se não existir). `includeDrafts` para o dono. */
export async function getCampaign(
  campaignId: number,
  includeDrafts = false
): Promise<(CampaignWithStats & { owner_username: string | null; store_slug: string | null }) | null> {
  const rows = (await sql`
    SELECT c.id, c.owner_id, c.title, c.description, c.status, c.starts_at, c.ends_at,
           c.created_at, c.updated_at,
           u.name AS owner_name, u.username AS owner_username,
           (SELECT s.slug FROM stores s WHERE s.owner_id = c.owner_id LIMIT 1) AS store_slug,
           (SELECT COUNT(*)::int FROM opportunities o WHERE o.campaign_id = c.id) AS opportunity_count,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o2 ON o2.id = r.opportunity_id
             WHERE o2.campaign_id = c.id) AS codes_issued,
           (SELECT COUNT(*)::int FROM redemption_codes r
              JOIN opportunities o3 ON o3.id = r.opportunity_id
             WHERE o3.campaign_id = c.id AND r.status = 'utilizado') AS codes_used
      FROM campaigns c
      JOIN users u ON u.id = c.owner_id
     WHERE c.id = ${campaignId}
       AND (u.blocked = FALSE)
       AND (${includeDrafts} OR c.status IN ('ativa', 'pausada'))
     LIMIT 1
  `) as unknown as (CampaignWithStats & {
    owner_username: string | null;
    store_slug: string | null;
  })[];
  return rows[0] ?? null;
}

/* ──────────────────────── Oportunidades ──────────────────────── */

export interface OpportunityWithStats extends OpportunityRow {
  codes_issued: number;
  codes_used: number;
}

/** Oportunidades de uma campanha (`includeAll` para o dono). */
export async function listOpportunities(
  campaignId: number,
  includeAll = false
): Promise<OpportunityWithStats[]> {
  const rows = (await sql`
    SELECT o.id, o.campaign_id, o.title, o.description, o.kind, o.discount_percent,
           o.mission_text, o.total_codes, o.max_claims_per_consumer, o.code_ttl_hours,
           o.status, o.created_at, o.updated_at,
           (SELECT COUNT(*)::int FROM redemption_codes r WHERE r.opportunity_id = o.id) AS codes_issued,
           (SELECT COUNT(*)::int FROM redemption_codes r
             WHERE r.opportunity_id = o.id AND r.status = 'utilizado') AS codes_used
      FROM opportunities o
     WHERE o.campaign_id = ${campaignId}
       AND (${includeAll} OR o.status = 'ativa')
     ORDER BY o.created_at DESC
  `) as unknown as OpportunityWithStats[];
  return rows;
}

export async function getOpportunity(
  opportunityId: number
): Promise<(OpportunityRow & { campaign_owner_id: number; campaign_status: CampaignStatus }) | null> {
  const rows = (await sql`
    SELECT o.id, o.campaign_id, o.title, o.description, o.kind, o.discount_percent,
           o.mission_text, o.total_codes, o.max_claims_per_consumer, o.code_ttl_hours,
           o.status, o.created_at, o.updated_at,
           c.owner_id AS campaign_owner_id, c.status AS campaign_status
      FROM opportunities o
      JOIN campaigns c ON c.id = o.campaign_id
     WHERE o.id = ${opportunityId}
     LIMIT 1
  `) as unknown as (OpportunityRow & {
    campaign_owner_id: number;
    campaign_status: CampaignStatus;
  })[];
  return rows[0] ?? null;
}

/* ──────────────── Claim (resgate de código) — idempotente ──────────────── */

export interface ClaimResult {
  ok: true;
  code: string;
  expires_at: string;
  /** TRUE quando devolveu um código já emitido (idempotência). */
  reused: boolean;
}

export type ClaimError =
  | { ok: false; status: 400 | 404 | 409 | 410; error: string };

/**
 * Emite (ou devolve) o código de redemption de uma oportunidade para o
 * consumidor anónimo/autenticado. Idempotente: novo claim do mesmo
 * consumidor para a mesma oportunidade devolve o MESMO código ativo.
 *
 * `affiliateCode`/`subId` vêm do RefCapture existente (?ref=&sub=) —
 * atribuem a distribuição a quem partilhou o link (nunca deduplicam
 * identidade: a identidade é o anon_id/user_id, não o IP/WhatsApp).
 */
export async function claimOpportunity(input: {
  opportunityId: number;
  anonId: string;
  userId: number | null;
  affiliateCode: string | null;
  subId: string | null;
}): Promise<ClaimResult | ClaimError> {
  const { opportunityId, anonId, userId, affiliateCode, subId } = input;

  const opportunity = await getOpportunity(opportunityId);
  if (!opportunity || opportunity.status !== 'ativa' || opportunity.campaign_status !== 'ativa') {
    return { ok: false, status: 404, error: 'Oportunidade não encontrada ou não está ativa.' };
  }

  // Idempotência: devolve o código ativo já emitido para este consumidor.
  const existing = (await sql`
    SELECT code, expires_at FROM redemption_codes
     WHERE opportunity_id = ${opportunityId}
       AND anon_id = ${anonId}
       AND status = 'emitido'
       AND expires_at > now()
     ORDER BY id DESC
     LIMIT 1
  `) as unknown as { code: string; expires_at: string }[];
  if (existing[0]) {
    return { ok: true, code: existing[0].code, expires_at: existing[0].expires_at, reused: true };
  }

  // Limite de claims por consumidor (código ativo já consumido conta).
  if (opportunity.max_claims_per_consumer > 1) {
    const mine = (await sql`
      SELECT COUNT(*)::int AS n FROM redemption_codes
       WHERE opportunity_id = ${opportunityId} AND anon_id = ${anonId}
    `) as unknown as { n: number }[];
    if ((mine[0]?.n ?? 0) >= opportunity.max_claims_per_consumer) {
      return {
        ok: false,
        status: 409,
        error: 'Já atingiste o limite de códigos desta oportunidade.',
      };
    }
  }

  // Total de códigos (-1 = ilimitado) — esgota a oportunidade atomicamente.
  if (opportunity.total_codes >= 0) {
    const issued = (await sql`
      SELECT COUNT(*)::int AS n FROM redemption_codes
       WHERE opportunity_id = ${opportunityId}
    `) as unknown as { n: number }[];
    if ((issued[0]?.n ?? 0) >= opportunity.total_codes) {
      await sql`
        UPDATE opportunities SET status = 'esgotada', updated_at = now()
         WHERE id = ${opportunityId} AND status = 'ativa'
      `;
      return { ok: false, status: 410, error: 'Os códigos desta oportunidade esgotaram.' };
    }
  }

  // Resolve a atribuição de distribuição (código de afiliado, se válido).
  let refAffiliateId: number | null = null;
  if (affiliateCode && /^[A-Z0-9-]{4,20}$/.test(affiliateCode)) {
    const affiliate = (await sql`
      SELECT a.id FROM affiliates a
       WHERE a.codigo_afiliado = ${affiliateCode} AND a.active = TRUE
       LIMIT 1
    `) as unknown as { id: number }[];
    refAffiliateId = affiliate[0]?.id ?? null;
  }

  const code = await generateRedemptionCode();
  const expiresAt = new Date(Date.now() + opportunity.code_ttl_hours * 60 * 60 * 1000);

  // UNIQUE parcial (opportunity_id, anon_id) WHERE emitido protege contra
  // duplo claim em corrida; ON CONFLICT devolve o idempotente.
  const inserted = (await sql`
    INSERT INTO redemption_codes
      (opportunity_id, code, anon_id, user_id, ref_affiliate_id, sub_id, status, expires_at)
    VALUES
      (${opportunityId}, ${code}, ${anonId}, ${userId}, ${refAffiliateId}, ${subId}, 'emitido', ${expiresAt.toISOString()})
    ON CONFLICT (opportunity_id, anon_id) WHERE status = 'emitido'
    DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, redemption_codes.user_id)
    RETURNING code, expires_at
  `) as unknown as { code: string; expires_at: string }[];

  if (inserted[0]) {
    return {
      ok: true,
      code: inserted[0].code,
      expires_at: inserted[0].expires_at,
      reused: inserted[0].code !== code,
    };
  }
  // Improvável — sem linha devolvida, re-executa a leitura idempotente.
  const again = (await sql`
    SELECT code, expires_at FROM redemption_codes
     WHERE opportunity_id = ${opportunityId} AND anon_id = ${anonId} AND status = 'emitido'
     LIMIT 1
  `) as unknown as { code: string; expires_at: string }[];
  if (again[0]) {
    return { ok: true, code: again[0].code, expires_at: again[0].expires_at, reused: true };
  }
  return { ok: false, status: 400, error: 'Não foi possível emitir o código. Tenta novamente.' };
}

/* ──────────── Validação do código na loja (atómica) ──────────── */

export interface ValidateResult {
  ok: true;
  opportunity_title: string;
  campaign_title: string;
  used_at: string;
}

/**
 * Valida (utiliza) um código de redemption — atómico:
 * `UPDATE … WHERE status='emitido' AND expires_at > now()` garante que
 * códigos usados/expirados NÃO podem ser validados duas vezes, mesmo em
 * pedidos concorrentes. Apenas o dono da campanha (ou admin) valida.
 */
export async function redeemCode(input: {
  code: string;
  validatorUserId: number;
  isAdmin: boolean;
}): Promise<ValidateResult | { ok: false; status: 400 | 403 | 404; error: string }> {
  const normalized = input.code.trim().toUpperCase();
  if (!new RegExp(`^${REDEMPTION_CODE_PREFIX}-[A-Z0-9]{4,12}$`).test(normalized)) {
    return { ok: false, status: 400, error: 'Formato de código inválido (GMB-XXXXXX).' };
  }

  const rows = (await sql`
    SELECT r.id, r.status, r.expires_at, o.title AS opportunity_title,
           c.title AS campaign_title, c.owner_id
      FROM redemption_codes r
      JOIN opportunities o ON o.id = r.opportunity_id
      JOIN campaigns c ON c.id = o.campaign_id
     WHERE r.code = ${normalized}
     LIMIT 1
  `) as unknown as {
    id: number;
    status: string;
    expires_at: string;
    opportunity_title: string;
    campaign_title: string;
    owner_id: number;
  }[];

  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, error: 'Código não encontrado.' };
  }
  if (!input.isAdmin && row.owner_id !== input.validatorUserId) {
    // Não revela ao estranho que o código existe (anti-enumeração).
    return { ok: false, status: 404, error: 'Código não encontrado.' };
  }

  if (row.status === 'utilizado') {
    return { ok: false, status: 400, error: 'Este código já foi utilizado.' };
  }
  if (row.status === 'invalidado') {
    return { ok: false, status: 400, error: 'Este código foi invalidado.' };
  }
  if (new Date(row.expires_at).getTime() <= Date.now() || row.status === 'expirado') {
    // Marca como expirado (limpeza preguiçosa) e responde.
    await sql`
      UPDATE redemption_codes SET status = 'expirado'
       WHERE id = ${row.id} AND status = 'emitido'
    `;
    return { ok: false, status: 400, error: 'Este código já expirou.' };
  }

  // Validação atômica — apenas a transição emitido→utilizado passa.
  const updated = (await sql`
    UPDATE redemption_codes
       SET status = 'utilizado', used_at = now(), used_by = ${input.validatorUserId}
     WHERE id = ${row.id} AND status = 'emitido' AND expires_at > now()
    RETURNING used_at
  `) as unknown as { used_at: string }[];

  if (!updated[0]) {
    return { ok: false, status: 400, error: 'Este código já foi utilizado.' };
  }

  return {
    ok: true,
    opportunity_title: row.opportunity_title,
    campaign_title: row.campaign_title,
    used_at: updated[0].used_at,
  };
}

/* ───────────────────── Métricas por campanha ───────────────────── */

export interface CampaignStats {
  total_codes: number;
  used_codes: number;
  conversion: number;
  by_opportunity: { title: string; issued: number; used: number }[];
  by_channel: { sub_id: string | null; issued: number; used: number }[];
}

/** Métricas do dono: emissões, utilizações, conversão, canais. */
export async function getCampaignStats(campaignId: number): Promise<CampaignStats> {
  const byOpportunity = (await sql`
    SELECT o.title,
           (SELECT COUNT(*)::int FROM redemption_codes r WHERE r.opportunity_id = o.id) AS issued,
           (SELECT COUNT(*)::int FROM redemption_codes r
             WHERE r.opportunity_id = o.id AND r.status = 'utilizado') AS used
      FROM opportunities o
     WHERE o.campaign_id = ${campaignId}
     ORDER BY o.created_at DESC
  `) as unknown as { title: string; issued: number; used: number }[];

  const byChannel = (await sql`
    SELECT r.sub_id,
           COUNT(*)::int AS issued,
           COUNT(*) FILTER (WHERE r.status = 'utilizado')::int AS used
      FROM redemption_codes r
      JOIN opportunities o ON o.id = r.opportunity_id
     WHERE o.campaign_id = ${campaignId}
     GROUP BY r.sub_id
     ORDER BY used DESC, issued DESC
  `) as unknown as { sub_id: string | null; issued: number; used: number }[];

  const total = byOpportunity.reduce((acc, o) => acc + Number(o.issued), 0);
  const used = byOpportunity.reduce((acc, o) => acc + Number(o.used), 0);

  return {
    total_codes: total,
    used_codes: used,
    conversion: total > 0 ? Math.round((used / total) * 100) : 0,
    by_opportunity: byOpportunity.map((o) => ({
      title: o.title,
      issued: Number(o.issued),
      used: Number(o.used),
    })),
    by_channel: byChannel.map((c) => ({
      sub_id: c.sub_id,
      issued: Number(c.issued),
      used: Number(c.used),
    })),
  };
}

/* ─────────── Resultados do distribuidor (afiliado) ─────────── */

export interface DistributionRow {
  campaign_title: string;
  opportunity_title: string;
  issued: number;
  used: number;
}

/**
 * Resultados das distribuições do afiliado autenticado: quantos códigos
 * das oportunidades que ele partilhou foram emitidos/utilizados.
 * Reutiliza ref_affiliate_id (atribuição do claim).
 */
export async function listMyDistributions(
  affiliateId: number
): Promise<DistributionRow[]> {
  const rows = (await sql`
    SELECT c.title AS campaign_title, o.title AS opportunity_title,
           COUNT(*)::int AS issued,
           COUNT(*) FILTER (WHERE r.status = 'utilizado')::int AS used
      FROM redemption_codes r
      JOIN opportunities o ON o.id = r.opportunity_id
      JOIN campaigns c ON c.id = o.campaign_id
     WHERE r.ref_affiliate_id = ${affiliateId}
     GROUP BY c.title, o.title
     ORDER BY used DESC, issued DESC
     LIMIT 100
  `) as unknown as DistributionRow[];
  return rows.map((r) => ({
    campaign_title: r.campaign_title,
    opportunity_title: r.opportunity_title,
    issued: Number(r.issued),
    used: Number(r.used),
  }));
}
