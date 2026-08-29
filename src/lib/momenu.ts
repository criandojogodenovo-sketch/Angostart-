import 'server-only';

/**
 * AngoStart — Gateway MoMenu (Fase 6, ponto 9) — PREPARAÇÃO.
 *
 * O MoMenu é um gateway angolano com suporte a Multicaixa Express e
 * Referências. A integração em si não tem custo de código; a MoMenu cobra
 * uma taxa por transação (tipicamente 1,5%–3%) descontada ao comerciante.
 *
 * Estado (não quebra nada enquanto a chave não existir):
 *  - MOMENU_API_KEY definida na Vercel → a opção "MoMenu (Multicaixa Express)"
 *    aparece no checkout (via /api/config → momenuEnabled).
 *  - Sem chave → checkout continua KWiK manual como método principal.
 *  - MOMENU_SANDBOX=true → "modo sandbox": devolve uma referência simulada
 *    SEM chamar a API real (para testes de fluxo) — nunca ativa pagamentos
 *    reais.
 *
 * Integração real (a confirmar com a MoMenu):
 *  - POST {base}/payments          → cria intenção de pagamento
 *  - GET  {base}/payments/:id      → consulta estado
 *  - POST {base}/payments/:id/confirm → confirma + webhook de callback
 */

export function momenuEnabled(): boolean {
  const key = process.env.MOMENU_API_KEY;
  return !!key && key.trim().length > 0 && key.trim() !== 'SEU_API_KEY';
}

export function momenuSandbox(): boolean {
  return process.env.MOMENU_SANDBOX === 'true';
}

/** Taxa indicativa do gateway (para transparência no dashboard, 1,5–3%). */
export const MOMENU_FEE_RANGE = '1.5%–3%';

export interface MoMenuPaymentInput {
  orderId: number;
  amountKz: number;
  customerPhone: string;
  description: string;
}

export interface MoMenuPaymentResult {
  ok: boolean;
  paymentId?: string;
  /** Referência Multicaixa Express / URL de checkout, conforme o método. */
  checkoutUrl?: string;
  reference?: string;
  sandbox?: boolean;
  error?: string;
}

/**
 * Cria uma intenção de pagamento MoMenu.
 *  - Sandbox: devolve referência simulada `MOMENU-SB-<orderId>` sem chamada externa.
 *  - Real: POST para a API MoMenu com MOMENU_API_KEY (a ativar quando a conta
 *    de comerciante estiver aprovada e a documentação final for entregue).
 */
export async function createPayment(input: MoMenuPaymentInput): Promise<MoMenuPaymentResult> {
  if (!momenuEnabled()) {
    return {
      ok: false,
      error:
        'Pagamento automático MoMenu em breve — por agora usa a transferência KWiK manual.',
    };
  }

  const apiKey = process.env.MOMENU_API_KEY as string;

  if (momenuSandbox()) {
    return {
      ok: true,
      sandbox: true,
      paymentId: `SB-${input.orderId}-${Date.now()}`,
      reference: `MOMENU-SB-${String(input.orderId).padStart(5, '0')}`,
      checkoutUrl: `/carrinho?momenu=sandbox&order=${input.orderId}`,
    };
  }

  // TODO (integração real): substituir pelo endpoint definitivo da MoMenu.
  // Exemplo de estrutura esperada — confirmar com o gateway:
  // const res = await fetch(`${base}/payments`, {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     amount: input.amountKz,
  //     currency: 'AOA',
  //     phone: input.customerPhone,
  //     description: input.description,
  //     external_id: input.orderId,
  //   }),
  // });
  void apiKey;
  void input;
  return { ok: false, error: 'Integração MoMenu real ainda não ativada.' };
}

/** Verifica o estado de um pagamento MoMenu (sandbox → pending sempre). */
export async function getPaymentStatus(paymentId: string): Promise<{
  ok: boolean;
  status?: 'pending' | 'paid' | 'failed';
  sandbox?: boolean;
  error?: string;
}> {
  if (momenuSandbox() && paymentId.startsWith('SB-')) {
    return { ok: true, sandbox: true, status: 'pending' };
  }
  if (!momenuEnabled()) {
    return { ok: false, error: 'MoMenu ainda não está ativo.' };
  }
  // TODO (integração real): GET {base}/payments/:id
  return { ok: false, error: 'Integração MoMenu real ainda não ativada.' };
}
