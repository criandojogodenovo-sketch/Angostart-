import 'server-only';
import { sql } from '@/lib/db';

/**
 * AngoStart — Carteira (Fase W) — TODA a lógica no servidor.
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

export const WALLET_MIN_DEPOSIT = 500; // Kz
export const WALLET_MAX_DEPOSIT = 500_000; // Kz
export const WALLET_MIN_WITHDRAW = 1_000; // Kz
export const WALLET_MAX_WITHDRAW = 1_000_000; // Kz

/** Comissão da plataforma paga a afiliados (Fase A). */
export const AFFILIATE_DEFAULT_PERCENT = 10;

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
}): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO wallet_transactions
      (user_id, tipo, valor, status, order_id, descricao, referencia)
    SELECT ${input.userId}, ${input.tipo}, ${input.valor}, ${input.status},
           ${input.orderId}, ${input.descricao},
           ${'AngoStart-ORD-' + String(input.orderId).padStart(5, '0')}
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
 * Crédito em ESCROW: quando a encomenda passa a `pago`, cada vendedor
 * recebe a sua parte em `saldo_bloqueado` (retida até `entregue`).
 */
export async function creditSellersOnPaid(orderId: number): Promise<void> {
  const shares = await sellerSharesOfOrder(orderId);
  for (const share of shares) {
    await ensureWallet(share.sellerId);
    const inserted = await insertOrderTxOnce({
      userId: share.sellerId,
      tipo: 'recebimento',
      valor: share.total,
      status: 'bloqueado',
      orderId,
      descricao: 'Venda confirmada — valor retido até entrega',
    });
    if (inserted) {
      await sql`
        UPDATE wallets
        SET saldo_bloqueado = saldo_bloqueado + ${share.total}, updated_at = now()
        WHERE user_id = ${share.sellerId}
      `;
    }
  }
}

/**
 * Comissão de afiliado (Fase A): paga automaticamente quando a venda é
 * `pago`. Idempotente — a tabela affiliate_earnings é UNIQUE
 * (affiliate_id, order_id).
 */
export async function payAffiliateCommission(
  orderId: number,
  orderTotalKz: number,
  affiliateCode: string | null
): Promise<void> {
  if (!affiliateCode) return;
  const code = affiliateCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return;

  const rows = (await sql`
    SELECT a.id, a.user_id, a.comissao_percentual::float8
    FROM affiliates a
    WHERE a.codigo_afiliado = ${code}
    LIMIT 1
  `) as unknown as { id: number; user_id: number; comissao_percentual: number }[];

  const affiliate = rows[0];
  if (!affiliate) return;

  const comissao = Math.floor((orderTotalKz * affiliate.comissao_percentual) / 100);
  if (comissao < 1) return;

  const earned = (await sql`
    INSERT INTO affiliate_earnings (affiliate_id, order_id, comissao, percentual, status)
    SELECT ${affiliate.id}, ${orderId}, ${comissao}, ${affiliate.comissao_percentual}, 'pago'
    WHERE NOT EXISTS (
      SELECT 1 FROM affiliate_earnings
      WHERE affiliate_id = ${affiliate.id} AND order_id = ${orderId}
    )
    RETURNING id
  `) as unknown as { id: number }[];
  if (!earned[0]) return;

  await ensureWallet(affiliate.user_id);
  const inserted = await insertOrderTxOnce({
    userId: affiliate.user_id,
    tipo: 'comissao',
    valor: comissao,
    status: 'concluido',
    orderId,
    descricao: `Comissão de afiliado (${affiliate.comissao_percentual}%)`,
  });
  if (inserted) {
    await creditSaldo(affiliate.user_id, comissao);
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
      SELECT total_kz::float8 AS total, affiliate_code
      FROM orders WHERE id = ${orderId} LIMIT 1
    `) as unknown as { total: number; affiliate_code: string | null }[];
    await creditSellersOnPaid(orderId);
    await payAffiliateCommission(orderId, toNumber(order[0]?.total), order[0]?.affiliate_code ?? null);
  }
  if (nextStatus === 'entregue') {
    await releaseOnDelivered(orderId);
  }
  if (nextStatus === 'rejeitado' || nextStatus === 'falhou') {
    await refundWalletPayment(orderId);
  }
}
