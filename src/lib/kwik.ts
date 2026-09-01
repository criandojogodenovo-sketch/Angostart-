/**
 * AngoStart — KWiK (Kwanza Instantâneo): pagamento MANUAL por transferência.
 *
 * Fluxo:
 *  1. Cliente escolhe "KWiK (Transferência Instantânea)" no carrinho.
 *  2. Transfere o valor exato para o número KWiK da AngoStart, indicando a
 *     referência do pedido (ex.: AngoStart-ORD-00042) na descrição.
 *  3. Anexa o comprovativo (foto ou PDF) no campo de upload.
 *  4. O pedido fica com status `aguardando_validacao` até um admin
 *     (total ou limitado) aprovar (`pago`) ou rejeitar (`rejeitado`).
 *
 * ⚠️ Este módulo é partilhado (cliente + servidor): contém apenas
 * constantes públicas e funções puras — SEM segredos.
 */

/** Número KWiK que recebe as transferências (exibido nas instruções). */
export const KWIK_PAYEE_NUMBER = '+244 958 176 915';

/** Número KWiK apenas com dígitos (para copiar/colar). */
export const KWIK_PAYEE_DIGITS = '244958176915';

/** Tamanho máximo do comprovativo: 2 MB (antes da codificação base64). */
export const KWIK_PROOF_MAX_BYTES = 2 * 1024 * 1024;

/** Tipos MIME aceites no upload do comprovativo. */
export const KWIK_PROOF_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/** Estados possíveis de uma encomenda KWiK. */
export type KwikOrderStatus =
  | 'pendente'
  | 'aguardando_validacao'
  | 'pago'
  | 'entregue'
  | 'rejeitado'
  | 'falhou';

/** Rótulos legíveis dos estados (usados no carrinho, perfil e painéis). */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente de pagamento',
  aguardando_validacao: 'Aguardando validação do comprovativo',
  pago: 'Pago — confirmado',
  entregue: 'Entregue',
  rejeitado: 'Comprovativo rejeitado',
  falhou: 'Pagamento falhou',
};

/** Cores dos badges de estado (Tailwind). */
export const ORDER_STATUS_BADGES: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-700',
  aguardando_validacao: 'bg-sky-100 text-sky-700',
  pago: 'bg-blue-100 text-blue-700',
  entregue: 'bg-blue-100 text-blue-700',
  rejeitado: 'bg-rose-100 text-rose-700',
  falhou: 'bg-rose-100 text-rose-700',
};

/**
 * Referência do pedido para identificar a transferência.
 * Ex.: orderId=42 → "AngoStart-ORD-00042"
 */
export function buildKwikReference(orderId: number): string {
  return `AngoStart-ORD-${String(orderId).padStart(5, '0')}`;
}

/** Mensagem de transferência pronta a copiar (descrição do pagamento). */
export function buildKwikTransferNote(orderId: number, customerName: string): string {
  return `${buildKwikReference(orderId)} — ${customerName.slice(0, 40)}`;
}

export interface ParsedProof {
  mime: string;
  base64: string;
  /** Data URL completo (data:<mime>;base64,<dados>) — guardado em BD. */
  dataUrl: string;
  bytes: number;
  name: string;
}

/**
 * Valida um comprovativo enviado como data URL (`data:<mime>;base64,<dados>`).
 *
 * 🔒 Segurança (servidor):
 * - Tipo MIME contra whitelist (imagens + PDF).
 * - Tamanho máximo 2 MB (decodificado).
 * - "Magic bytes" verificados — não confia no MIME declarado pelo cliente.
 * - Nome sanitizado (só [A-Za-z0-9._-], máx. 80 caracteres).
 *
 * Devolve `null` se o comprovativo for inválido.
 */
export function parseAndValidateProof(input: {
  dataUrl: unknown;
  fileName?: unknown;
}): ParsedProof | null {
  if (typeof input.dataUrl !== 'string') return null;
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(
    input.dataUrl.trim()
  );
  if (!match) return null;

  const mime = match[1].toLowerCase();
  if (!(KWIK_PROOF_MIME_TYPES as readonly string[]).includes(mime)) return null;

  const base64 = match[2];
  // Tamanho real dos bytes decodificados (≈ 3/4 do comprimento base64)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  if (bytes <= 0 || bytes > KWIK_PROOF_MAX_BYTES) return null;

  const rawName = typeof input.fileName === 'string' ? input.fileName : 'comprovativo';
  const name =
    rawName
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'comprovativo';

  /* ── Magic bytes: valida a assinatura real do ficheiro ── */
  let head: string;
  try {
    head = atob(base64.slice(0, 32));
  } catch {
    return null;
  }
  const bytesHead = [...head].map((c) => c.charCodeAt(0));
  const startsWith = (sig: number[]) =>
    sig.every((b, i) => bytesHead[i] === b);
  const isJpeg = startsWith([0xff, 0xd8, 0xff]);
  const isPng = startsWith([0x89, 0x50, 0x4e, 0x47]);
  const isPdf = head.startsWith('%PDF');
  const isWebP =
    startsWith([0x52, 0x49, 0x46, 0x46]) && head.slice(8, 12) === 'WEBP';

  const magicOk =
    (mime === 'image/jpeg' && isJpeg) ||
    (mime === 'image/png' && isPng) ||
    (mime === 'application/pdf' && isPdf) ||
    (mime === 'image/webp' && isWebP);
  if (!magicOk) return null;

  return { mime, base64, dataUrl: input.dataUrl.trim(), bytes, name };
}
