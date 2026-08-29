/**
 * AngoStart — CONFIGURAÇÃO CENTRAL DE PARÂMETROS DE NEGÓCIO (Fase 5)
 *
 * Único ponto de verdade para comissões e limites da carteira. Todos os
 * valores podem ser ajustados em produção via Environment Variables da
 * Vercel (sem redeploy de código) e têm valores por defeito seguros.
 *
 * ⚠️ Client-safe: este ficheiro é importado por Client Components para
 * validar formulários em tempo real. No cliente, `process.env.*` (sem
 * prefixo NEXT_PUBLIC_) é indefinido — aplicam-se os DEFAULTS. No
 * servidor, `getBusinessConfig()` lê as variáveis reais e é a fonte
 * autoritativa de toda a validação.
 */

/* ───────────────────────── Valores por defeito ──────────────────────── */

/** Comissão de afiliados (% sobre a venda paga). */
export const DEFAULT_AFFILIATE_COMMISSION_PERCENT = 10;

/** Limites da carteira por operação (Kz) — anti-lavagem. */
export const DEFAULT_MAX_DEPOSIT_AMOUNT = 200_000;
export const DEFAULT_MIN_DEPOSIT_AMOUNT = 1_000;
export const DEFAULT_MAX_WITHDRAW_AMOUNT = 100_000;
export const DEFAULT_MIN_WITHDRAW_AMOUNT = 5_000;

/** Limites diários por utilizador (Kz) — compliance. */
export const DEFAULT_MAX_DAILY_DEPOSIT = 500_000;
export const DEFAULT_MAX_DAILY_WITHDRAW = 300_000;

/** Comissões da AngoStart por venda (descontadas ao vendedor/prestador). */
export const DEFAULT_COMMISSION_PRODUCT = 5; // % — produtos físicos e infoprodutos (criadores)
export const DEFAULT_COMMISSION_SERVICE_DOMICILIO = 10; // % — prestadores ao domicílio
export const DEFAULT_COMMISSION_FREELANCER = 6.5; // % — freelancers / serviços remotos

/* ─────────────────────────── Leitura no servidor ────────────────────── */

export interface BusinessConfig {
  affiliateCommissionPercent: number;
  maxDepositAmount: number;
  minDepositAmount: number;
  maxWithdrawAmount: number;
  minWithdrawAmount: number;
  maxDailyDeposit: number;
  maxDailyWithdraw: number;
  commissionProduct: number;
  commissionServiceDomicilio: number;
  commissionFreelancer: number;
}

function envNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Configuração efetiva do negócio (⚡ apenas servidor — lê process.env).
 * Os Client Components usam `BUSINESS_DEFAULTS` para validação imediata;
 * o servidor SEMPRE revalida com esta função.
 */
export function getBusinessConfig(): BusinessConfig {
  return {
    affiliateCommissionPercent: envNumber(
      process.env.AFFILIATE_COMMISSION_PERCENT,
      DEFAULT_AFFILIATE_COMMISSION_PERCENT
    ),
    maxDepositAmount: envNumber(process.env.MAX_DEPOSIT_AMOUNT, DEFAULT_MAX_DEPOSIT_AMOUNT),
    minDepositAmount: envNumber(process.env.MIN_DEPOSIT_AMOUNT, DEFAULT_MIN_DEPOSIT_AMOUNT),
    maxWithdrawAmount: envNumber(process.env.MAX_WITHDRAW_AMOUNT, DEFAULT_MAX_WITHDRAW_AMOUNT),
    minWithdrawAmount: envNumber(process.env.MIN_WITHDRAW_AMOUNT, DEFAULT_MIN_WITHDRAW_AMOUNT),
    maxDailyDeposit: envNumber(process.env.MAX_DAILY_DEPOSIT, DEFAULT_MAX_DAILY_DEPOSIT),
    maxDailyWithdraw: envNumber(process.env.MAX_DAILY_WITHDRAW, DEFAULT_MAX_DAILY_WITHDRAW),
    commissionProduct: envNumber(process.env.COMMISSION_PRODUCT, DEFAULT_COMMISSION_PRODUCT),
    commissionServiceDomicilio: envNumber(
      process.env.COMMISSION_SERVICE_DOMICILIO,
      DEFAULT_COMMISSION_SERVICE_DOMICILIO
    ),
    commissionFreelancer: envNumber(
      process.env.COMMISSION_FREELANCER,
      DEFAULT_COMMISSION_FREELANCER
    ),
  };
}

/* ───────────────── Defaults para o cliente (validação em tempo real) ── */

export const BUSINESS_DEFAULTS: BusinessConfig = {
  affiliateCommissionPercent: DEFAULT_AFFILIATE_COMMISSION_PERCENT,
  maxDepositAmount: DEFAULT_MAX_DEPOSIT_AMOUNT,
  minDepositAmount: DEFAULT_MIN_DEPOSIT_AMOUNT,
  maxWithdrawAmount: DEFAULT_MAX_WITHDRAW_AMOUNT,
  minWithdrawAmount: DEFAULT_MIN_WITHDRAW_AMOUNT,
  maxDailyDeposit: DEFAULT_MAX_DAILY_DEPOSIT,
  maxDailyWithdraw: DEFAULT_MAX_DAILY_WITHDRAW,
  commissionProduct: DEFAULT_COMMISSION_PRODUCT,
  commissionServiceDomicilio: DEFAULT_COMMISSION_SERVICE_DOMICILIO,
  commissionFreelancer: DEFAULT_COMMISSION_FREELANCER,
};

/* ─────────────────────────── Comissões por perfil ───────────────────── */

/**
 * Percentual de comissão da AngoStart consoante o perfil do vendedor:
 *  - criador (infoprodutos / produtos físicos) → COMMISSION_PRODUCT
 *  - prestador_domicilio                       → COMMISSION_SERVICE_DOMICILIO
 *  - prestador_remoto (freelancer)             → COMMISSION_FREELANCER
 */
export function commissionPercentForRole(
  role: string | null | undefined,
  config: BusinessConfig = BUSINESS_DEFAULTS
): number {
  switch (role) {
    case 'prestador_domicilio':
      return config.commissionServiceDomicilio;
    case 'prestador_remoto':
      return config.commissionFreelancer;
    default:
      return config.commissionProduct;
  }
}

/** Valida um montante de operação da carteira (usado no cliente e servidor). */
export function validateAmount(
  tipo: 'deposito' | 'saque',
  valor: number,
  config: BusinessConfig = BUSINESS_DEFAULTS
): { ok: boolean; error?: string } {
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: 'Indica um valor válido em Kwanzas.' };
  }
  if (tipo === 'deposito') {
    if (valor < config.minDepositAmount) {
      return { ok: false, error: `O depósito mínimo é ${config.minDepositAmount} Kz.` };
    }
    if (valor > config.maxDepositAmount) {
      return { ok: false, error: `O depósito máximo por operação é ${config.maxDepositAmount} Kz.` };
    }
  } else {
    if (valor < config.minWithdrawAmount) {
      return { ok: false, error: `O saque mínimo é ${config.minWithdrawAmount} Kz.` };
    }
    if (valor > config.maxWithdrawAmount) {
      return { ok: false, error: `O saque máximo por operação é ${config.maxWithdrawAmount} Kz.` };
    }
  }
  return { ok: true };
}
