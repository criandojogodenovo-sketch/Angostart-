/**
 * AngoStart — Ilustração de estado vazio (Fase 18).
 *
 * Caixa aberta amigável com partículas azul/roxo a subir + confeti discreto.
 * Usada em catálogos sem resultados, listas vazias e página 404.
 */

export default function EmptyIllustration({ className = 'h-40 w-40' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={className} role="img" aria-label="Sem resultados">
      <defs>
        <linearGradient id="empty-box" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="empty-box-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>

      {/* Sombra no chão */}
      <ellipse cx="100" cy="146" rx="58" ry="8" fill="rgba(100,116,139,0.15)" />

      {/* Partículas flutuantes */}
      <circle cx="58" cy="52" r="4" fill="#93c5fd" opacity="0.8" />
      <circle cx="146" cy="40" r="3" fill="#c4b5fd" opacity="0.8" />
      <circle cx="128" cy="72" r="2.5" fill="#5eead4" opacity="0.7" />
      <path d="M64 88 l5 -5 5 5 -5 5 Z" fill="#a78bfa" opacity="0.6" />
      <circle cx="148" cy="96" r="2" fill="#93c5fd" opacity="0.6" />

      {/* Caixa aberta */}
      <path d="M55 92 L100 112 L145 92 L145 128 L100 148 L55 128 Z" fill="url(#empty-box)" opacity="0.9" />
      <path d="M55 92 L100 112 L100 148 L55 128 Z" fill="rgba(30,41,59,0.18)" />
      {/* Aletas abertas */}
      <path d="M55 92 L28 78 L74 60 L100 74 Z" fill="url(#empty-box-lid)" opacity="0.75" />
      <path d="M145 92 L172 78 L126 60 L100 74 Z" fill="url(#empty-box-lid)" opacity="0.55" />

      {/* Brilho dentro da caixa */}
      <circle cx="100" cy="112" r="6" fill="#fbbf24" opacity="0.9" />
      <path d="M97 112 q3 -6 6 0 q-3 6 -6 0" fill="#f59e0b" opacity="0.9" />
    </svg>
  );
}
