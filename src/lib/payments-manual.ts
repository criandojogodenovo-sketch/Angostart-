/**
 * AngoStart — Métodos de pagamento MANUAIS por transferência.
 *
 * KWiK (principal, RECOMENDADO), PayPay e Multicaixa Express — os três
 * chegam ao MESMO número da AngoStart (+244 958 176 915); o que muda é a
 * app que o cliente usa para enviar o dinheiro. O fluxo de validação é
 * idêntico: cliente anexa comprovativo → admin aprova (`pago`).
 *
 * ⚠️ Módulo partilhado (cliente + servidor): apenas constantes públicas e
 * funções puras — SEM segredos. MoMenu (automático) continua em
 * lib/momenu.ts e permanece DESATIVADO.
 */

import { KWIK_PAYEE_NUMBER } from '@/lib/kwik';

export type ManualMethodId = 'kwik' | 'paypay' | 'multicaixa_express';

export interface ManualMethod {
  id: ManualMethodId;
  /** Rótulo completo (radios do carrinho). */
  label: string;
  /** Rótulo curto (badges do admin/perfil). */
  badge: string;
  /** Descrição curta sob o rádio no carrinho. */
  hint: string;
  /** Nome da app/canal onde o cliente faz a transferência. */
  sender: string;
  /** Classes Tailwind do badge no admin. */
  badgeClass: string;
  /** Classes do painel de instruções no carrinho. */
  panelClass: string;
}

export const MANUAL_TRANSFER_METHODS: Record<ManualMethodId, ManualMethod> = {
  kwik: {
    id: 'kwik',
    label: 'KWiK (Transferência Instantânea)',
    badge: 'KWiK',
    hint: `Transfere para ${KWIK_PAYEE_NUMBER} e anexa o comprovativo — validamos e despachamos.`,
    sender: 'KWiK — Kwanza Instantâneo',
    badgeClass: 'bg-emerald-50 text-emerald-600',
    panelClass: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  paypay: {
    id: 'paypay',
    label: 'PayPay (Transferência)',
    badge: 'PayPay',
    hint: `Abre a app PayPay e transfere para ${KWIK_PAYEE_NUMBER} — anexa o comprovativo.`,
    sender: 'PayPay',
    badgeClass: 'bg-sky-50 text-sky-600',
    panelClass: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  multicaixa_express: {
    id: 'multicaixa_express',
    label: 'Multicaixa Express (Transferência)',
    badge: 'Multicaixa Express',
    hint: `Na app Multicaixa Express escolhe «Transferência» e envia para ${KWIK_PAYEE_NUMBER}.`,
    sender: 'Multicaixa Express',
    badgeClass: 'bg-violet-50 text-violet-600',
    panelClass: 'border-violet-200 bg-violet-50 text-violet-900',
  },
};

export const MANUAL_METHOD_IDS: ManualMethodId[] = [
  'kwik',
  'paypay',
  'multicaixa_express',
];

/** Type guard — true para os três métodos manuais de transferência. */
export function isManualTransferMethod(value: unknown): value is ManualMethodId {
  return (
    value === 'kwik' || value === 'paypay' || value === 'multicaixa_express'
  );
}

/** Rótulos legíveis de TODOS os métodos (badges no admin e histórico). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  kwik: 'KWiK',
  paypay: 'PayPay',
  multicaixa_express: 'Multicaixa Express',
  whatsapp: 'WhatsApp',
  carteira: 'Carteira',
  momenu: 'MoMenu',
};

/** Cores dos badges de método (Tailwind) — usados no admin/perfil. */
export const PAYMENT_METHOD_BADGES: Record<string, string> = {
  kwik: MANUAL_TRANSFER_METHODS.kwik.badgeClass,
  paypay: MANUAL_TRANSFER_METHODS.paypay.badgeClass,
  multicaixa_express: MANUAL_TRANSFER_METHODS.multicaixa_express.badgeClass,
  whatsapp: 'bg-amber-50 text-amber-600',
  carteira: 'bg-teal-50 text-teal-600',
  momenu: 'bg-sky-50 text-sky-600',
};

/**
 * Validação local do comprovativo de imagem de produto (cliente).
 * O servidor volta a validar tudo (MIME + magic bytes) — defesa em
 * profundidade.
 */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const PRODUCT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const PRODUCT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Formato do URL interno devolvido por POST /api/upload/image.
 * Servido publicamente por GET /api/media/[...path] (apenas `produtos/`).
 * Ex.: /api/media/produtos/12/1735689600000-foto-do-produto.jpg
 */
export function isInternalMediaUrl(value: string): boolean {
  return /^\/api\/media\/produtos\/\d+\/\d{13}-[A-Za-z0-9._-]{1,120}$/.test(
    value
  );
}
