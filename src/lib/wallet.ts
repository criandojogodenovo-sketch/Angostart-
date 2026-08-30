import 'server-only';
import { sql } from '@/lib/db';
import { getBusinessConfig } from '@/lib/config';
import { getEffectiveCommissionPercent } from '@/lib/commissions';

/**
 * AngoStart — Carteira (Fase W + Fase 5) — TODA a lógica no servidor.
 *
 * 🔒 SEGURANÇA:
 * - `server-only` garante que saldos e movimentações NUNCA entram no
 *   bundle do cliente — o saldo só chega ao browser via API autenticada.
 * - Débitos atómicos: `UPDATE … WHERE saldo >= valor RETURNING` — a base
 *   de dados recusa saldos negativos mesmo sob pedidos concorrentes.
 * - Escrow: o pagamento por carteira fica retido até o admin validar a
 *   encomenda; o vendedor recebe em `saldo_bloqueado` e liberta quando
 *   o pedido é `entregue`.
 * - Idempotência: movimentações por encomenda são únicas
 *   (order_id + tipo + user_id) — creditar 2× é impossível.
 * - Auditoria: cada decisão admin guarda processed_by + processed_at.
 */

/* ───────────────────────── Limites operacionais ─────────────────────── */

/**
 * Fase 5 — os limites vivem em `lib/config.ts` (env-configuráveis).
 * Estas funções são a porta de entrada server-side; os valores por defeito
 * ficam no config (1.000–200.000 Kz depósito; 5.000–100.000 Kz saque).
 */
export function walletLimits() {
  const c = getBusinessConfig();
  return {
    minDeposit: c.minDepositAmount,
    maxDeposit: c.maxDepositAmount,
    minWithdraw: c.minWithdrawAmount,
    maxWithdraw: c.maxWithdrawAmount,
    maxDailyDeposit: c.maxDailyDeposit,
    maxDailyWithdraw: c.maxDailyWithdraw,
  };
}

/** @deprecated legado — usa `walletLimits()` (valores reais do config). */
export const WALLET_MIN_DEPOSIT = 1_000; // Kz
/** @deprecated legado — usa `walletLimits()`. */
export const WALLET_MAX_DEPOSIT = 200_000; // Kz
/** @deprecated legado — usa `walletLimits()`. */
export const WALLET_MIN_WITHDRAW = 5_000; // Kz
/** @deprecated legado — usa `walletLimits()`. */
export const WALLET_MAX_WITHDRAW = 100_000; // Kz

export type WalletTxTipo =
  | 'deposito'
  | 'saque'
  | 'pagamento'
  | 'recebimento'
  | 'comissao'
  | 'liberacao'
  | 'reembolso';

export interface WalletRow {
  user_id: number;
  saldo: number;
  saldo_bloqueado: number;
}

export interface WalletTx {
  id: number;
  tipo: WalletTxTipo;
  valor: number;
  status: 'pendente' | 'concluido' | 'rejeitado' | 'bloqueado';
  referencia: string | null;
  order_id: number | null;
  descricao: string | null;
  created_at: string;
}

/** Referência legível para depósitos/saques (ex.: AngoStart-DEP-00042). */
export function walletReference(prefix: 'DEP' | 'WD', id: number): string {
  return `AngoStart-${prefix}-${String(id).padStart(5, '0')}`;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* ─────────────────────────── Leitura / garantia ─────────────────────── */

/** Cria a carteira se não existir e devolve os saldos atuais. */
export async function ensureWallet(userId: number): Promise<WalletRow> {
  await sql`
    INSERT INTO wallets (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO NOTHING
  `;
  const rows = (await sql`
    SELECT user_id, saldo::float8, saldo_bloqueado::float8
    FROM wallets WHERE user_id = ${userId} LIMIT 1
  `) as unknown as { user_id: number; saldo: number; saldo_bloqueado: number }[];
  const row = rows[0];
  return {
    user_id: userId,
    saldo: toNumber(row?.saldo),
    saldo_bloqueado: toNumber(row?.saldo_bloqueado),
  };
}

/** Diário de movimentações do utilizador (mais recentes primeiro). */
export async function listWalletTransactions(
  userId: number,
  limit = 30
): Promise<WalletTx[]> {
  const rows = (await sql`
    SELECT id, tipo, valor::float8, status, referencia, order_id, descricao, created_at
    FROM wallet_transactions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    tipo: r.tipo as WalletTxTipo,
    valor: toNumber(r.valor),
    status: r.status as WalletTx['status'],
    referencia: (r.referencia as string) ?? null,
    order_id: r.order_id === null || r.order_id === undefined ? null : Number(r.order_id),
    descricao: (r.descricao as string) ?? null,
    created_at: String(r.created_at),
  }));
}

/* ──────────────────────── Débito / crédito atómicos ─────────────────── */

/**
 * Débito atómico do saldo disponível. Lança `InsufficientFundsError`
 * quando o saldo é insuficiente (a BD recusa saldos negativos).
 */
async function debitSaldo(userId: number, valor: number): Promise<void> {
  const rows = (await sql`
    UPDATE wallets
    SET saldo = saldo - ${valor}, updated_at = now()
    WHERE user_id = ${userId} AND saldo >= ${valor}
    RETURNING user_id
  `) as unknown as { user_id: number }[];
  if (!rows[0]) {
    throw new InsufficientFundsError();
  }
}

async function creditSaldo(userId: number, valor: number): Promise<void> {
  await sql`
    UPDATE wallets
    SET saldo = saldo + ${valor}, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super('Saldo insuficiente na carteira.');
    this.name = 'InsufficientFundsError';
  }
}

/* ──────────────────────────── Pedidos do utilizador ─────────────────── */

/**
 * Depósito: cria movimentação `pendente` com referência manual.
 * O saldo SÓ entra quando um admin aprova (comprovativo verificado).
 */
export async function requestDeposit(
  userId: number,
  valor: number
): Promise<{ id: number; referencia: string }> {
  const inserted = (await sql`
    INSERT INTO wallet_transactions (user_id, tipo, valor, status, descricao)
    VALUES (${userId}, 'deposito', ${valor}, 'pendente', 'Depósito via Afrimoney / UNITEL Money')
    RETURNING id
  `) as unknown as { id: number }[];

  const id = inserted[0].id;
  const referencia = walletReference('DEP', id);
  await sql`
    UPDATE wallet_transactions SET referencia = ${referencia} WHERE id = ${id}
  `;
  return { id, referencia };
}

/**
 * Saque: debita IMEDIATAMENTE o pedido do saldo (reserva) e cria
 * movimentação `pendente`. Se o admin rejeitar, o valor é devolvido.
 * O envio do dinheiro (Afrimoney/UNITEL) é manual, feito pela equipa.
 */
export async function requestWithdraw(
  userId: number,
  valor: number
): Promise<{ id: number; referencia: string }> {
  await ensureWallet(userId);
  await debitSaldo(userId, valor);

  const inserted = (await sql`
    INSERT INTO wallet_transactions (user_id, tipo, valor, status, descricao)
    VALUES (${userId}, 'saque', ${valor}, 'pendente', 'Saque via Afrimoney / UNITEL Money')
    RETURNING id
  `) as unknown as { id: number }[];

  const id = inserted[0].id;
  const referencia = walletReference('WD', id);
  await sql`
    UPDATE wallet_transactions SET referencia = ${referencia} WHERE id = ${id}
  `;
  return { id, referencia };
}

/* ─────────────────────────── Painel do admin ────────────────────────── */

export interface AdminWalletOp extends WalletTx {
  user_name: string | null;
  user_email: string | null;
  user_telefone: string | null;
}

/** Fila de operações pendentes (depósitos e saques) para o admin. */
export async function listPendingWalletOps(limit = 50): Promise<AdminWalletOp[]> {
  const rows = (await sql`
    SELECT t.id, t.tipo, t.valor::float8, t.status, t.referencia, t.order_id,
           t.descricao, t.created_at,
           u.name AS user_name, u.email AS user_email, u.telefone AS user_telefone
    FROM wallet_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.status = 'pendente' AND t.tipo IN ('deposito', 'saque')
    ORDER BY t.created_at ASC, t.id ASC
    LIMIT ${limit}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    tipo: r.tipo as WalletTxTipo,
    valor: toNumber(r.valor),
    status: r.status as WalletTx['status'],
    referencia: (r.referencia as string) ?? null,
    order_id: r.order_id === null || r.order_id === undefined ? null : Number(r.order_id),
    descricao: (r.descricao as string) ?? null,
    created_at: String(r.created_at),
    user_name: (r.user_name as string) ?? null,
    user_email: (r.user_email as string) ?? null,
    user_telefone: (r.user_telefone as string) ?? null,
  }));
}

/**
 * Decisão do admin sobre um depósito/saque pendente.
 * - deposito + aprovar → entra no saldo disponível.
 * - saque + rejeitar → devolve o valor reservado ao saldo.
 * Devolve os dados da operação para notificação do utilizador.
 */
export async function decideWalletTransaction(
  txId: number,
  approve: boolean,
  adminId: number
): Promise<{
  ok: boolean;
  user_email: string | null;
  tipo?: WalletTxTipo;
  valor?: number;
  referencia?: string | null;
} | null> {
  const rows = (await sql`
    SELECT t.id, t.user_id, t.tipo, t.valor::float8 AS valor, t.status, t.referencia
    FROM wallet_transactions t
    WHERE t.id = ${txId} LIMIT 1
  `) as unknown as {
    id: number;
    user_id: number;
    tipo: WalletTxTipo;
    valor: number;
    status: string;
    referencia: string | null;
  }[];

  const tx = rows[0];
  if (!tx) return null;
  if (tx.status !== 'pendente' || (tx.tipo !== 'deposito' && tx.tipo !== 'saque')) {
    return { ok: false, user_email: null, tipo: tx.tipo };
  }

  if (tx.tipo === 'deposito' && approve) {
    await creditSaldo(tx.user_id, tx.valor);
  }
  if (tx.tipo === 'saque' && !approve) {
    await creditSaldo(tx.user_id, tx.valor); // devolve a reserva
  }

  await sql`
    UPDATE wallet_transactions
    SET status = ${approve ? 'concluido' : 'rejeitado'},
        processed_by = ${adminId},
        processed_at = now()
    WHERE id = ${txId} AND status = 'pendente'
  `;

  const userRows = (await sql`
    SELECT email FROM users WHERE id = ${tx.user_id} LIMIT 1
  `) as unknown as { email: string | null }[];

  return {
    ok: true,
    user_email: userRows[0]?.email ?? null,
    tipo: tx.tipo,
    valor: tx.valor,
    referencia: tx.referencia,
  };
}

/* ──────────────────────── Pagamento / escrow / comissões ────────────── */

/**
 * Pagamento de encomenda com saldo da carteira (escrow).
 * Débito atómico + movimentação `pagamento` concluída.
 */
export async function payWithWallet(
  userId: number,
  orderId: number,
  totalKz: number
): Promise<void> {
  await ensureWallet(userId);
  await debitSaldo(userId, totalKz);
  await sql`
    INSERT INTO wallet_transactions
      (user_id, tipo, valor, status, referencia, order_id, descricao)
    VALUES (${userId}, 'pagamento', ${totalKz}, 'concluido',
            ${'AngoStart-ORD-' + String(orderId).padStart(5, '0')}, ${orderId},
            'Pagamento de encomenda com saldo da carteira')
  `;
}

/** Subtotais por vendedor de uma encomenda (a partir do JSONB items). */
async function sellerSharesOfOrder(
  orderId: number
): Promise<{ sellerId: number; total: number }[]> {
  const rows = (await sql`
    SELECT (item->>'seller_id')::int AS seller_id,
           SUM((item->>'price_kz')::numeric * (item->>'quantity')::numeric)::float8 AS total
    FROM orders o,
         jsonb_array_elements(o.items) AS item
    WHERE o.id = ${orderId}
      AND item->>'seller_id' IS NOT NULL
      AND (item->>'seller_id')::int > 0
    GROUP BY 1
  `) as unknown as { seller_id: number; total: number }[];
  return rows.map((r) => ({ sellerId: Number(r.seller_id), total: toNumber(r.total) }));
}

/** Insere movimentação por encomenda apenas se ainda não existir (idempotente). */
async function insertOrderTxOnce(input: {
  userId: number;
  tipo: WalletTxTipo;
  valor: number;
  status: WalletTx['status'];
  orderId: number;
  descricao: string;
  commissionKz?: number;
}): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO wallet_transactions
      (user_id, tipo, valor, status, order_id, descricao, referencia, commission_kz)
    SELECT ${input.userId}, ${input.tipo}, ${input.valor}, ${input.status},
           ${input.orderId}, ${input.descricao},
           ${'AngoStart-ORD-' + String(input.orderId).padStart(5, '0')},
           ${input.commissionKz ?? 0}
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE order_id = ${input.orderId}
        AND tipo = ${input.tipo}
        AND user_id = ${input.userId}
    )
    RETURNING id
  `) as unknown as { id: number }[];
  return Boolean(rows[0]);
}

/**
 * Crédito em ESCROW com COMISSÃO DA ANGOSTART (Fase 5): quando a encomenda
 * passa a `pago`, cada vendedor recebe a sua parte LÍQUIDA em
 * `saldo_bloqueado` (retida até `entregue`). A comissão (5 % criadores,
 * 10 % domicílio, 6,5 % freelancers — ver lib/config.ts) fica registada
 * em `wallet_transactions.commission_kz` e em `orders.platform_commission_kz`.
 */
export async function creditSellersOnPaid(orderId: number): Promise<void> {
  const shares = await sellerSharesOfOrder(orderId);
  if (shares.length === 0) return;

  const sellerIds = shares.map((s) => s.sellerId);
  const roleRows = (await sql`
    SELECT id, role FROM users
    WHERE id = ANY(string_to_array(${sellerIds.join(',')}, ',')::int[])
  `) as unknown as { id: number; role: string }[];
  const roleById = new Map(roleRows.map((r) => [Number(r.id), r.role]));

  let orderCommission = 0;

  for (const share of shares) {
    // Fase 7 — taxa efetiva: override individual > tabela admin > default env
    const { percent } = await getEffectiveCommissionPercent(
      share.sellerId,
      roleById.get(share.sellerId)
    );
    const commissionKz = Math.floor((share.total * percent) / 100);
    const net = Math.max(share.total - commissionKz, 0);
    orderCommission += commissionKz;

    await ensureWallet(share.sellerId);
    const inserted = await insertOrderTxOnce({
      userId: share.sellerId,
      tipo: 'recebimento',
      valor: net,
      status: 'bloqueado',
      orderId,
      descricao:
        commissionKz > 0
          ? `Venda confirmada — comissão ${percent}% (${commissionKz} Kz) retida até entrega`
          : 'Venda confirmada — valor retido até entrega',
      commissionKz,
    });
    if (inserted) {
      await sql`
        UPDATE wallets
        SET saldo_bloqueado = saldo_bloqueado + ${net}, updated_at = now()
        WHERE user_id = ${share.sellerId}
      `;
    }
  }

  if (orderCommission > 0) {
    await sql`
      UPDATE orders SET platform_commission_kz = ${orderCommission}
      WHERE id = ${orderId} AND platform_commission_kz = 0
    `;
  }
}

/**
 * Comissão de afiliado (Fase A + Fase 5 + Fase 9): paga automaticamente
 * quando a venda é `pago`. Idempotente.
 *
 * Fase 9 — escalão automático (50+ comissões → 15 %) e deteção de fraude:
 *  - Autoindicação (afiliado = comprador) → comissão bloqueada + suspeito.
 *  - Mesmo IP de registo (afiliado vs comprador) → bloqueada + suspeito.
 *  - Suspeitos ficam em suspicious_activities e o admin é notificado.
 */
export async function payAffiliateCommission(
  orderId: number,
  orderTotalKz: number,
  affiliateCode: string | null,
  buyerId: number | null = null
): Promise<void> {
  if (!affiliateCode) return;
  const code = affiliateCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return;

  const rows = (await sql`
    SELECT a.id, a.user_id, a.comissao_percentual::float8, a.active::boolean,
           u.signup_ip AS affiliate_signup_ip
    FROM affiliates a
    JOIN users u ON u.id = a.user_id
    WHERE a.codigo_afiliado = ${code}
    LIMIT 1
  `) as unknown as {
    id: number;
    user_id: number;
    comissao_percentual: number;
    active: boolean;
    affiliate_signup_ip: string | null;
  }[];

  const affiliate = rows[0];
  if (!affiliate) return;
  if (!affiliate.active) return;

  /* ── Deteção de fraude (Fase 9, ponto 3C) ── */
  if (buyerId !== null && buyerId === affiliate.user_id) {
    await flagAffiliateFraud(
      affiliate.user_id,
      orderId,
      'Autoindicação no programa de afiliados — o afiliado comprou com o próprio código.',
      'alta'
    );
    return;
  }
  if (buyerId !== null) {
    const buyerRows = (await sql`
      SELECT signup_ip FROM users WHERE id = ${buyerId} LIMIT 1
    `) as unknown as { signup_ip: string | null }[];
    const buyerIp = buyerRows[0]?.signup_ip ?? null;
    if (
      buyerIp &&
      affiliate.affiliate_signup_ip &&
      buyerIp === affiliate.affiliate_signup_ip
    ) {
      await flagAffiliateFraud(
        affiliate.user_id,
        orderId,
        `Comissão bloqueada: comprador registado a partir do mesmo IP do afiliado (${buyerIp}).`,
        'alta'
      );
      return;
    }
  }

  /* ── Escalão automático: 50+ comissões → 15 % ── */
  const { resolveAffiliatePercent } = await import('@/lib/affiliate');
  const percentual = await resolveAffiliatePercent(affiliate);

  /* Produto único da encomenda (rastreio por produto, Fase 9). */
  let productId: number | null = null;
  const itemRows = (await sql`
    SELECT (item->>'id')::int AS id
    FROM orders, jsonb_array_elements(items) item
    WHERE id = ${orderId}
    LIMIT 2
  `) as unknown as { id: number }[];
  if (itemRows.length === 1 && Number.isInteger(itemRows[0]?.id)) {
    productId = itemRows[0].id;
  }

  const comissao = Math.floor((orderTotalKz * percentual) / 100);
  if (comissao < 1) return;

  const earned = (await sql`
    INSERT INTO affiliate_earnings (affiliate_id, order_id, product_id, comissao, percentual, status)
    SELECT ${affiliate.id}, ${orderId}, ${productId}, ${comissao}, ${percentual}, 'pago'
    WHERE NOT EXISTS (
      SELECT 1 FROM affiliate_earnings
      WHERE affiliate_id = ${affiliate.id} AND order_id = ${orderId}
    )
    RETURNING id
  `) as unknown as { id: number }[];
  if (!earned[0]) return;

  await sql`
    UPDATE affiliates
    SET total_earnings = total_earnings + ${comissao}, updated_at = NOW()
    WHERE id = ${affiliate.id}
  `;

  await ensureWallet(affiliate.user_id);
  const inserted = await insertOrderTxOnce({
    userId: affiliate.user_id,
    tipo: 'comissao',
    valor: comissao,
    status: 'concluido',
    orderId,
    descricao: `Comissão de afiliado (${percentual}%)`,
  });
  if (inserted) {
    await creditSaldo(affiliate.user_id, comissao);
  }
}

/**
 * Marca atividade suspeita de afiliado + notifica o admin (Fase 9).
 * Melhor-esforço: falha nunca bloqueia o fluxo de pagamento.
 */
async function flagAffiliateFraud(
  affiliateUserId: number,
  orderId: number,
  detalhe: string,
  severidade: 'baixa' | 'media' | 'alta'
): Promise<void> {
  try {
    await sql`
      INSERT INTO suspicious_activities (user_id, action, details, severity)
      VALUES (${affiliateUserId}, ${'fraude_afiliado'}, ${`${detalhe} (encomenda #${orderId})`}, ${severidade})
    `;
    const { sendAdminAlertEmail } = await import('@/lib/email');
    await sendAdminAlertEmail(
      'Fraude de afiliado detetada',
      `<p>${detalhe}</p><p><strong>Encomenda:</strong> #${orderId}</p>`
    );
  } catch (error) {
    console.error('[wallet] Falha ao registar suspeita de fraude de afiliado:', error);
  }
}

/**
 * Liberta o escrow: quando a encomenda é `entregue`, o valor retido dos
 * vendedores passa de `saldo_bloqueado` para `saldo` disponível.
 */
export async function releaseOnDelivered(orderId: number): Promise<void> {
  const rows = (await sql`
    SELECT user_id, valor::float8 AS valor
    FROM wallet_transactions
    WHERE order_id = ${orderId} AND tipo = 'recebimento' AND status = 'bloqueado'
  `) as unknown as { user_id: number; valor: number }[];

  for (const row of rows) {
    const inserted = await insertOrderTxOnce({
      userId: row.user_id,
      tipo: 'liberacao',
      valor: row.valor,
      status: 'concluido',
      orderId,
      descricao: 'Encomenda entregue — valor libertado da retenção',
    });
    if (inserted) {
      await sql`
        UPDATE wallets
        SET saldo = saldo + ${row.valor},
            saldo_bloqueado = saldo_bloqueado - ${row.valor},
            updated_at = now()
        WHERE user_id = ${row.user_id}
      `;
    }
  }
}

/**
 * Reembolso: se uma encomenda paga com carteira é `rejeitado`/`falhou`,
 * o cliente recebe o valor de volta no saldo disponível.
 */
export async function refundWalletPayment(orderId: number): Promise<void> {
  const rows = (await sql`
    SELECT user_id, valor::float8 AS valor
    FROM wallet_transactions
    WHERE order_id = ${orderId} AND tipo = 'pagamento' AND status = 'concluido'
  `) as unknown as { user_id: number; valor: number }[];

  for (const row of rows) {
    const inserted = await insertOrderTxOnce({
      userId: row.user_id,
      tipo: 'reembolso',
      valor: row.valor,
      status: 'concluido',
      orderId,
      descricao: 'Encomenda recusada — valor devolvido à carteira',
    });
    if (inserted) {
      await creditSaldo(row.user_id, row.valor);
    }
  }
}

/* ───────────────────────── Disputas (Fase 6) ─────────────────────────── */

/**
 * Retira dos vendedores o escrow ainda bloqueado de uma encomenda
 * (resolução de disputa a favor do cliente). Idempotente: só mexe em
 * movimentações `recebimento` com estado `bloqueado`.
 * Devolve o total retirado de `saldo_bloqueado`.
 */
export async function clawbackBlockedEscrowForDispute(orderId: number): Promise<number> {
  const rows = (await sql`
    SELECT id, user_id, valor::float8 AS valor
    FROM wallet_transactions
    WHERE order_id = ${orderId} AND tipo = 'recebimento' AND status = 'bloqueado'
  `) as unknown as { id: number; user_id: number; valor: number }[];

  let total = 0;
  for (const row of rows) {
    const clawbackNote = `Disputa — valor retido devolvido ao cliente (encomenda #${orderId})`;
    const updated = (await sql`
      UPDATE wallet_transactions
      SET status = 'rejeitado',
          descricao = ${clawbackNote}
      WHERE id = ${row.id} AND status = 'bloqueado'
      RETURNING id
    `) as unknown as { id: number }[];
    if (!updated[0]) continue; // outra resolução chegou primeiro

    await sql`
      UPDATE wallets
      SET saldo_bloqueado = GREATEST(saldo_bloqueado - ${row.valor}, 0), updated_at = now()
      WHERE user_id = ${row.user_id}
    `;
    total += row.valor;
  }
  return total;
}

/**
 * Crédita ao comprador o reembolso de uma disputa (a favor do cliente),
 * idempotente por (order_id, tipo='reembolso', user_id) — chamar 2× não
 * credita 2×. Devolve true se o crédito foi aplicado agora.
 */
export async function refundDisputeToBuyer(
  orderId: number,
  buyerId: number,
  totalKz: number
): Promise<boolean> {
  if (totalKz <= 0) return false;
  await ensureWallet(buyerId);
  const inserted = await insertOrderTxOnce({
    userId: buyerId,
    tipo: 'reembolso',
    valor: totalKz,
    status: 'concluido',
    orderId,
    descricao: 'Disputa resolvida a favor do cliente — reembolso integral',
  });
  if (!inserted) return false;
  await creditSaldo(buyerId, totalKz);
  return true;
}

/**
 * Efeitos colaterais de uma transição de estado de encomenda.
 * Chamado pelos painéis admin (validação de comprovativo / entrega).
 */
export async function applyOrderStatusSideEffects(
  orderId: number,
  prevStatus: string,
  nextStatus: string
): Promise<void> {
  if (nextStatus === 'pago' && prevStatus !== 'pago') {
    const order = (await sql`
      SELECT total_kz::float8 AS total, affiliate_code, user_id AS buyer_id
      FROM orders WHERE id = ${orderId} LIMIT 1
    `) as unknown as { total: number; affiliate_code: string | null; buyer_id: number | null }[];
    await creditSellersOnPaid(orderId);
    await payAffiliateCommission(
      orderId,
      toNumber(order[0]?.total),
      order[0]?.affiliate_code ?? null,
      order[0]?.buyer_id ?? null
    );

    // Fase 7 — notificações push: pedido pago (cliente) + venda realizada (vendedor)
    try {
      const { pushNotification } = await import('@/lib/notifications');
      if (order[0]?.buyer_id) {
        await pushNotification(
          Number(order[0].buyer_id),
          'Pedido pago ✓',
          `O teu pedido #${orderId} foi validado e está em preparação.`,
          '/perfil'
        );
      }
      const sellers = (await sql`
        SELECT DISTINCT (item->>'seller_id')::int AS seller_id
        FROM orders, jsonb_array_elements(items) item
        WHERE id = ${orderId} AND (item->>'seller_id')::int > 0
      `) as unknown as { seller_id: number }[];
      for (const s of sellers) {
        await pushNotification(
          Number(s.seller_id),
          'Venda realizada 🎉',
          `Tens uma nova venda no pedido #${orderId} — valor em escrow até à entrega.`,
          '/dashboard/vendedor'
        );
      }
      // Fase 7 — gamificação: +1 ponto por venda concluída + selos automáticos
      const { awardPoints, evaluateBadges } = await import('@/lib/gamification-server');
      for (const s of sellers) {
        await awardPoints(Number(s.seller_id), 1);
        await evaluateBadges(Number(s.seller_id));
      }
    } catch (sideEffectError) {
      console.error('[wallet] Efeitos colaterais Fase 7 falharam (não bloqueia):', sideEffectError);
    }
  }
  if (nextStatus === 'entregue') {
    await releaseOnDelivered(orderId);
  }
  if (nextStatus === 'rejeitado' || nextStatus === 'falhou') {
    await refundWalletPayment(orderId);
  }
}

/* ─────────────────────── Limites diários (Fase 5) ───────────────────── */

/**
 * Soma das operações concluídas/pendentes do dia (00:00 UTC) por tipo —
 * usada para validar MAX_DAILY_DEPOSIT / MAX_DAILY_WITHDRAW.
 */
export async function dailyTransactionTotal(
  userId: number,
  tipo: 'deposito' | 'saque'
): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(SUM(valor), 0)::float8 AS total
    FROM wallet_transactions
    WHERE user_id = ${userId}
      AND tipo = ${tipo}
      AND status IN ('pendente', 'concluido')
      AND created_at >= date_trunc('day', now())
  `) as unknown as { total: number }[];
  return toNumber(rows[0]?.total);
}
