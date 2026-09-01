/**
 * AngoStart — Padrão SVG decorativo de ondas/círculos (Fase 18).
 *
 * Overlay subtil para banners e cabeçalhos (lojas, portfólio, perfil, CTA).
 * Herda a largura do pai; decoração pura — escondido de leitores de ecrã.
 */

export default function PatternWaves({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 800 200"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      {/* Ondas suaves */}
      <path
        d="M0 150 C 150 90 300 190 450 130 C 600 70 700 150 800 110 L 800 200 L 0 200 Z"
        fill="rgba(255,255,255,0.06)"
      />
      <path
        d="M0 170 C 180 120 320 200 500 150 C 650 108 730 170 800 145 L 800 200 L 0 200 Z"
        fill="rgba(255,255,255,0.05)"
      />
      {/* Círculos decorativos */}
      <circle cx="690" cy="42" r="60" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      <circle cx="690" cy="42" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" strokeDasharray="4 6" />
      <circle cx="90" cy="30" r="4" fill="rgba(147,197,253,0.5)" />
      <circle cx="150" cy="60" r="2.5" fill="rgba(196,181,253,0.5)" />
      <circle cx="540" cy="24" r="3" fill="rgba(147,197,253,0.4)" />
      <circle cx="480" cy="52" r="2" fill="rgba(196,181,253,0.45)" />
    </svg>
  );
}
