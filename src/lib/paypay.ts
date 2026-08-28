import 'server-only';
import { randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

/**
 * AngoStart — Pagamentos Multicaixa Express (PayPay AO).
 *
 * ⚠️ SERVER-ONLY: as chaves RSA (PAYPAY_PRIVATE_KEY / PAYPAY_PUBLIC_KEY)
 * e o segredo do webhook vivem apenas no servidor.
 *
 * Modos de operação:
 * - PRODUÇÃO: PAYPAY_PARTNER_ID + PAYPAY_PRIVATE_KEY definidos → usa o SDK
 *   oficial `paypay-ao-sdk` (createMulticaixaPayment) contra o gateway PayPay.
 * - SANDBOX (sem chaves): gera uma referência local claramente marcada
 *   `simulated: true`, permitindo testar o fluxo completo (incl. webhook)
 *   sem credenciais reais. Nenhum dinheiro é movimentado.
 */

interface MulticaixaResult {
  simulated: boolean;
  outTradeNo: string;
  paypayTradeNo: string | null;
  status: 'pendente' | 'falhou';
  message: string;
  raw?: unknown;
}

/** true se as credenciais PayPay estão presentes no ambiente. */
export function isPayPayConfigured(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.PAYPAY_PARTNER_ID && env.PAYPAY_PRIVATE_KEY);
  } catch {
    return false;
  }
}

let cachedSdk: import('paypay-ao-sdk').PayPaySDK | null = null;

/** Instância (lazy) do SDK PayPay com as chaves do ambiente. */
async function getSdk(): Promise<import('paypay-ao-sdk').PayPaySDK | null> {
  if (!isPayPayConfigured()) return null;
  if (cachedSdk) return cachedSdk;
  const env = getEnv();
  const { PayPaySDK } = await import('paypay-ao-sdk');
  cachedSdk = new PayPaySDK(
    {
      partnerId: env.PAYPAY_PARTNER_ID!,
      privateKey: env.PAYPAY_PRIVATE_KEY!,
      paypayPublicKey: env.PAYPAY_PUBLIC_KEY,
      apiUrl: env.PAYPAY_API_URL,
    },
    { environment: 'production', timeout: 30, retryAttempts: 2 }
  );
  return cachedSdk as import('paypay-ao-sdk').PayPaySDK;
}

/** Número de transação único (marchante) — AS-<orderId>-<aleatório>. */
function buildOutTradeNo(orderId: number, simulated: boolean): string {
  const rand = randomBytes(4).toString('hex').toUpperCase();
  return `${simulated ? 'ASSIM' : 'AS'}-${orderId}-${rand}`;
}

/**
 * Cria um pedido de pagamento Multicaixa Express.
 * O cliente recebe a notificação na app Multicaixa e confirma com o PIN.
 */
export async function createMulticaixaPayment(input: {
  orderId: number;
  amountKz: number;
  phone: string; // 2449XXXXXXXX
  subject?: string;
}): Promise<MulticaixaResult> {
  const sdk = await getSdk();

  /* ── Modo SANDBOX (sem chaves) ── */
  if (!sdk) {
    const outTradeNo = buildOutTradeNo(input.orderId, true);
    console.log(
      `[paypay] SANDBOX: pagamento simulado criado — ${outTradeNo}, ` +
        `${input.amountKz} Kz para ${input.phone}`
    );
    return {
      simulated: true,
      outTradeNo,
      paypayTradeNo: null,
      status: 'pendente',
      message:
        'Modo sandbox: as chaves PayPay (PAYPAY_PARTNER_ID / PAYPAY_PRIVATE_KEY) não estão ' +
        'configuradas. O pedido foi registado localmente; adiciona as chaves na Vercel para ' +
        'cobranças reais via Multicaixa Express.',
    };
  }

  /* ── Modo PRODUÇÃO (SDK oficial) ── */
  try {
    const response = await sdk.createMulticaixaPayment({
      outTradeNo: buildOutTradeNo(input.orderId, false),
      amount: input.amountKz,
      phoneNum: input.phone,
      subject: input.subject?.slice(0, 120) || `AngoStart — encomenda #${input.orderId}`,
    });

    const ok = response?.code === '0' || /^00000/.test(response?.code ?? '');
    return {
      simulated: false,
      outTradeNo: response?.biz_content?.out_trade_no ?? '',
      paypayTradeNo: response?.biz_content?.trade_no ?? null,
      status: ok ? 'pendente' : 'falhou',
      message: ok
        ? 'Pedido enviado — confirma a notificação na app Multicaixa Express com o teu PIN.'
        : `PayPay recusou o pedido: ${response?.msg ?? response?.sub_msg ?? 'erro desconhecido'}`,
      raw: response,
    };
  } catch (error) {
    console.error('[paypay] Erro ao criar pagamento Multicaixa:', error);
    return {
      simulated: false,
      outTradeNo: '',
      paypayTradeNo: null,
      status: 'falhou',
      message: 'Não foi possível iniciar o pagamento agora. Tenta novamente em instantes.',
    };
  }
}

/** Consulta o estado real de uma transação (apenas modo produção). */
export async function queryPayPayStatus(outTradeNo: string): Promise<string | null> {
  const sdk = await getSdk();
  if (!sdk) return null;
  try {
    const res = await sdk.orderStatus(outTradeNo);
    return res?.trade_status ?? res?.biz_content?.status ?? null;
  } catch (error) {
    console.error('[paypay] orderStatus falhou:', error);
    return null;
  }
}
