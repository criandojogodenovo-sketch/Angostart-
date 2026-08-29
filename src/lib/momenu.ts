import 'server-only';

/**
 * AngoStart — Estrutura preparada para PAGAMENTO AUTOMÁTICO MoMenu (Fase 5).
 *
 * ⚠️ NÃO ATIVADO: a AngoStart continua a usar KWiK MANUAL como método
 * principal. Este módulo deixa a estrutura pronta para quando a conta
 * MoMenu estiver aprovada — basta implementar as chamadas HTTP reais
 * usando MOMENU_API_KEY (placeholder definido no .env / Vercel).
 *
 * Documentação esperada (a confirmar com o MoMenu):
 *  - POST {base}/payments      → cria intenção de pagamento
 *  - POST {base}/payments/:id/confirm → confirma + webhook de callback
 */

export const MOMENU_ENABLED = false; // ligar apenas quando a API real estiver aprovada

export interface MoMenuPaymentInput {
  orderId: number;
  amountKz: number;
  customerPhone: string;
  description: string;
}

export interface MoMenuPaymentResult {
  ok: boolean;
  paymentId?: string;
  checkoutUrl?: string;
  error?: string;
}

/** Cria uma intenção de pagamento MoMenu (PLACEHOLDER — não chama API real). */
export async function createPayment(input: MoMenuPaymentInput): Promise<MoMenuPaymentResult> {
  if (!MOMENU_ENABLED) {
    return {
      ok: false,
      error:
        'Pagamento automático MoMenu em breve — por agora usa a transferência KWiK manual.',
    };
  }

  const apiKey = process.env.MOMENU_API_KEY;
  if (!apiKey || apiKey === 'SEU_API_KEY') {
    return { ok: false, error: 'MOMENU_API_KEY não configurada.' };
  }

  // TODO (integração real): POST para a API MoMenu com MOMENU_API_KEY
  // e devolver checkoutUrl para o cliente autorizar o pagamento.
  void input;
  return { ok: false, error: 'Integração MoMenu não implementada.' };
}

/** Verifica o estado de um pagamento MoMenu (PLACEHOLDER). */
export async function getPaymentStatus(paymentId: string): Promise<{
  ok: boolean;
  status?: 'pending' | 'paid' | 'failed';
  error?: string;
}> {
  if (!MOMENU_ENABLED) {
    return { ok: false, error: 'MoMenu ainda não está ativo.' };
  }
  void paymentId;
  return { ok: false, error: 'Integração MoMenu não implementada.' };
}
