/**
 * AngoStart — KYC flexível orientado a fotos (Fase 12).
 *
 * ⚡ Client-safe: sem `import 'server-only'` — usado no cliente (cartão de
 * verificação, painel admin) e no servidor (upload, submissão, validação).
 * O servidor SEMPRE revalida — as helpers aqui são só formato/estado.
 *
 * Modelo de estados (users.kyc_status):
 *  - 'not_submitted' → conta criada sem documento. Pode vender normalmente,
 *     sem selo azul; dashboard mostra aviso para verificar identidade.
 *  - 'pending'       → documento (foto) submetido, à espera de revisão.
 *     Pode vender normalmente; selo chega após aprovação.
 *  - 'verified'      → admin aprovou → selo azul (is_verified_bi = TRUE).
 *  - 'rejected'      → admin recusou → BLOQUEADO de publicar novos produtos
 *     até submeter novo documento (kyc_status volta a 'pending').
 *  - 'none'          → não-vendedores (cliente/admin) — KYC não se aplica.
 */

export const KYC_DOCUMENT_TYPES = ['bi', 'passaporte', 'cartao_eleitor'] as const;

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export const KYC_DOCUMENT_TYPE_LABELS: Record<KycDocumentType, string> = {
  bi: 'Bilhete de Identidade',
  passaporte: 'Passaporte',
  cartao_eleitor: 'Cartão de Eleitor',
};

export const KYC_STATUS_LABELS: Record<string, string> = {
  not_submitted: 'Sem documento submetido',
  pending: 'Em análise',
  verified: 'Verificado',
  rejected: 'Recusado',
  none: 'Não aplicável',
};

/** Tamanho máximo do documento KYC (igual às fotos de produto). */
export const KYC_MAX_FILE_MB = 5;

/** MIME aceites (o servidor valida também magic bytes). */
export const KYC_FILE_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Formato do URL gerado por POST /api/kyc/upload e servido por
 * GET /api/kyc/document/[...path] (rota PRIVADA — só dono ou admin):
 *   /api/kyc/document/<userId>/<timestamp>-<nome-sanitizado>
 */
export function kycDocumentUrlRegex(userId?: number): RegExp {
  return userId !== undefined
    ? new RegExp(`^\\/api\\/kyc\\/document\\/${userId}\\/\\d{13}-[A-Za-z0-9._-]{1,120}$`)
    : /^\/api\/kyc\/document\/(\d+)\/\d{13}-[A-Za-z0-9._-]{1,120}$/;
}

/** O URL pertence ao formato interno do KYC (e, opcionalmente, ao utilizador). */
export function isKycDocumentUrl(value: string, userId?: number): boolean {
  return kycDocumentUrlRegex(userId).test(value);
}

/** Extrai o id do dono do documento a partir do URL (ou null). */
export function kycDocumentOwnerFromUrl(value: string): number | null {
  const m = value.match(kycDocumentUrlRegex());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Estado efetivo de KYC para lógica de UI/gates. */
export function kycAllowsPublishing(kycStatus: string | null | undefined): boolean {
  return kycStatus !== 'rejected';
}

export function kycHasBadge(kycStatus: string | null | undefined, isVerifiedBi?: boolean): boolean {
  return kycStatus === 'verified' || isVerifiedBi === true;
}
