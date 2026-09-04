'use client';

/**
 * AngoStart — Avatar3D (Fases 22→24 · compatibilidade).
 *
 * A partir da Fase 24 («cartoon 3D premium») este componente é um wrapper
 * fino do componente canónico Mascot3D — o personagem refinado (barba,
 * óculos de vidro com transmission, dentes, camisa com botões e smartwatch)
 * com a MESMA cena da home: pódio + anel emissivo + ContactShadows +
 * elementos flutuantes por variante. Ver Mascot3D.tsx / MascotCharacter.tsx.
 *
 * API mantida (PersonalizedHero não precisa de mudanças):
 *  - withGlasses → isLoggedIn (óculos só quando autenticado);
 *  - variant 'visitante' | 'logado' → elementos flutuantes.
 */

import Mascot3D from './Mascot3D';

export type Avatar3DProps = {
  /** Autenticado → óculos + elementos «logado». */
  withGlasses?: boolean;
  /** Variante da cena: 'visitante' (comércio) | 'logado' (dados). */
  variant?: 'visitante' | 'logado';
};

export default function Avatar3D({
  withGlasses = false,
  variant = 'visitante',
}: Avatar3DProps) {
  return (
    <Mascot3D
      context="home"
      isLoggedIn={withGlasses || variant === 'logado'}
    />
  );
}
