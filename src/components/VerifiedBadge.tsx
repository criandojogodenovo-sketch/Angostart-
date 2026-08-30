/**
 * AngoStart — Selo azul de verificação (Fase 9).
 * Exibido ao lado do nome de vendedores com BI aprovado pelo admin
 * (is_verified_bi = TRUE) — inspirado nos selos do Fiverr/Instagram.
 */

export default function VerifiedBadge({ size = 16 }: { size?: number }) {
  return (
    <span
      title="Vendedor verificado — identidade confirmada pela AngoStart"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-500 align-middle"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.68}
        height={size * 0.68}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Verificado"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
