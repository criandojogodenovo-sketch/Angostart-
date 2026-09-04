'use client';

/**
 * AngoStart — Mascot2D (Fase 24 · fallback 2D da mascote refinada).
 *
 * O MESMO personagem do 3D (Mascot3DCharacter), desenhado em SVG puro para
 * dispositivos sem WebGL / prefers-reduced-motion: barba definida + bigode,
 * cabelo escuro penteado, sorriso COM DENTES, camisa índigo com botões e
 * crachá, óculos (semohentes) quando `withGlasses`.
 *
 * Animações 100% CSS (globals.css — .angostart-mascot-mouth / .angostart-
 * mascot-think): a boca mexe-se enquanto `speaking` (lip sync 2D) e a bolha
 * de pensamento flutua quando `thinking`. Emoções (boca/sobrancelhas/olhos)
 * via estilos inline com transition — sem WebGL, sem custo, sem layout
 * shift (contentor de tamanho fixo).
 */

import type { MascotEmotion } from '@/lib/mascot-emotions';

export type Mascot2DProps = {
  /** Óculos desenhados (home logado / chat / painel). */
  withGlasses?: boolean;
  /** Boca mexe-se por CSS (fallback do lip sync do chat). */
  speaking?: boolean;
  /** Pose «a pensar»: cabeça inclinada + bolha de pensamento. */
  thinking?: boolean;
  /** Expressão — resultado de detectEmotion(). */
  emotion?: MascotEmotion;
  /** Chip flutuante (ex.: saudação) — usado no fallback da home. */
  chipLabel?: string;
};

export default function Mascot2D({
  withGlasses = false,
  speaking = false,
  thinking = false,
  emotion = 'neutro',
  chipLabel,
}: Mascot2DProps) {
  const feliz = emotion === 'feliz';
  const preocupado = emotion === 'preocupado';
  const pensativo = emotion === 'pensativo' || thinking;

  const browStyle = (lado: 'esq' | 'dir'): React.CSSProperties => {
    const origem = lado === 'esq' ? '36px 35px' : '64px 35px';
    if (preocupado)
      return {
        transform: lado === 'esq' ? 'rotate(16deg)' : 'rotate(-16deg)',
        transformOrigin: origem,
        transition: 'transform .3s',
      };
    if (feliz)
      return {
        transform: `translateY(-2px) rotate(${lado === 'esq' ? -5 : 5}deg)`,
        transformOrigin: origem,
        transition: 'transform .3s',
      };
    return {
      transform: `rotate(${lado === 'esq' ? -6 : 6}deg)`,
      transformOrigin: origem,
      transition: 'transform .3s',
    };
  };

  return (
    <div className="relative mx-auto h-full w-full select-none">
      {chipLabel && (
        <div className="animate-float absolute -left-1 top-5 z-10 flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:bg-slate-900/90">
          <span className="max-w-[9rem] truncate text-sm font-bold text-slate-800 dark:text-slate-100">
            {chipLabel}
          </span>
          <span className="text-base">👋</span>
        </div>
      )}

      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        role="img"
        aria-label="Mascote da AngoStart"
      >
        {/* Sombra falsa */}
        <ellipse cx="50" cy="98" rx="26" ry="2.5" fill="#0f172a" opacity="0.12" />

        {/* Camisa índigo com colarinho, pala de botões e crachá */}
        <path d="M18 100 C18 77 34 71 50 71 C66 71 82 77 82 100 Z" fill="#5a4fd6" />
        <path d="M46 72 h8 v28 h-8 Z" fill="#473db3" opacity="0.55" />
        <path d="M43 72 h6 l1 6 h-8 Z" fill="#f8fafc" />
        <path d="M51 72 h6 l1 6 h-8 Z" fill="#f8fafc" />
        {[80, 87, 94].map((y) => (
          <circle key={y} cx="50" cy={y} r="1.6" fill="#2a2450" />
        ))}
        <rect x="60" y="84" width="9" height="6.5" rx="1" fill="#f8fafc" />
        <rect x="60" y="84" width="9" height="1.8" rx="0.8" fill="#3b82f6" />

        {/* Cabeça (grupo — inclina quando pensa) */}
        <g
          style={{
            transform: pensativo ? 'rotate(-6deg)' : 'rotate(0deg)',
            transformOrigin: '50px 62px',
            transition: 'transform .3s',
          }}
        >
          <circle cx="21" cy="48" r="6" fill="#f2b380" />
          <circle cx="79" cy="48" r="6" fill="#f2b380" />
          <circle cx="50" cy="46" r="30" fill="#f2b380" />

          {/* Cabelo escuro penteado (volume + franja varrida) */}
          <path
            d="M20 46 C20 25 34 15 50 15 C66 15 80 25 80 46 C77 33 70 27 60 26 C63 30 59 32 54 31 C44 29 32 32 26 40 C23 43 21 45 20 46 Z"
            fill="#2b2742"
          />

          {/* BARBA definida (faixa no maxilar) + bigode + suíças */}
          <path
            d="M21 48 C21 69 33 81 50 81 C67 81 79 69 79 48 C75 60 68 55 50 55 C32 55 25 60 21 48 Z"
            fill="#332e4e"
          />
          <path d="M42 55 Q50 51 58 55 Q50 58 42 55 Z" fill="#332e4e" />

          {/* Sobrancelhas grossas (reagem à emoção) */}
          <rect x="29" y="32.5" width="13" height="3.4" rx="1.7" fill="#2b2742" style={browStyle('esq')} />
          <rect x="58" y="32.5" width="13" height="3.4" rx="1.7" fill="#2b2742" style={browStyle('dir')} />

          {/* Olhos com esclera + íris (semicerrados se preocupado; sobem se pensa) */}
          <g
            style={{
              transform: `${preocupado ? 'scaleY(0.65)' : 'scaleY(1)'} translateY(${pensativo ? -2 : 0}px)`,
              transformOrigin: '50px 46px',
              transition: 'transform .3s',
            }}
          >
            <circle cx="39" cy="46" r="4.4" fill="#f8fafc" />
            <circle cx="61" cy="46" r="4.4" fill="#f8fafc" />
            <circle cx="39.5" cy="46.5" r="2.3" fill="#4a3525" />
            <circle cx="60.5" cy="46.5" r="2.3" fill="#4a3525" />
            <circle cx="40.3" cy="45.6" r="0.8" fill="#ffffff" />
            <circle cx="61.3" cy="45.6" r="0.8" fill="#ffffff" />
          </g>

          {/* Nariz */}
          <ellipse cx="50" cy="52" rx="2.6" ry="3.4" fill="#e6a271" />

          {/* Óculos (vidro translúcido) */}
          {withGlasses && (
            <g>
              <circle cx="39" cy="46" r="9" fill="#dfeaff" fillOpacity="0.22" stroke="#1f2430" strokeWidth="2" />
              <circle cx="61" cy="46" r="9" fill="#dfeaff" fillOpacity="0.22" stroke="#1f2430" strokeWidth="2" />
              <path d="M48 46 h4" stroke="#1f2430" strokeWidth="2" strokeLinecap="round" />
              <path d="M30 46 L23 43" stroke="#1f2430" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M70 46 L77 43" stroke="#1f2430" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          )}

          {/* Boca: dentes visíveis (sorriso) / ellipse animada (fala) / ∩ (preocupado) */}
          {speaking ? (
            <g>
              <ellipse cx="50" cy="63" rx="6.5" ry="7" fill="#5b1f2a" className="angostart-mascot-mouth" />
              <path d="M44.5 59.5 h11 v3.2 a5.5 3 0 0 1 -11 0 Z" fill="#f8fafc" />
            </g>
          ) : preocupado ? (
            <path
              d="M42 64 Q50 56 58 64"
              stroke="#a04a38"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <g>
              <path d="M39 59 Q50 70 61 59 Z" fill="#f8fafc" />
              <path d="M39 59 Q50 63 61 59" fill="none" stroke="#a04a38" strokeWidth="1.6" strokeLinecap="round" />
              <path
                d={feliz ? 'M38 58 Q50 71 62 58' : 'M40 59 Q50 68 60 59'}
                stroke="#a04a38"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          )}
        </g>

        {/* Bolha de pensamento (2D — indigo, visível sobre fundo branco) */}
        {thinking && (
          <g className="angostart-mascot-think">
            <circle cx="83" cy="22" r="2.5" fill="#a5b4fc" />
            <circle cx="88" cy="13" r="3.5" fill="#a5b4fc" />
            <circle cx="93" cy="4" r="4.5" fill="#c7d2fe" />
          </g>
        )}
      </svg>
    </div>
  );
}
