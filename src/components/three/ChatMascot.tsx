'use client';

/**
 * AngoStart — ChatMascot (Fases 23→24 · compatibilidade).
 *
 * A partir da Fase 24 este componente é um wrapper fino do componente
 * canónico Mascot3D com context="chat": o personagem refinado (barba,
 * óculos de vidro, dentes, camisa com botões) em versão BUSTO, sincronizado
 * com a IA:
 *
 *  - LIP SYNC (prop `speaking`): a boca abre/fecha enquanto a resposta é
 *    revelada no balão SMS (~11 Hz modulada — nada de metrónomo);
 *  - PENSAR (prop `thinking` = isTyping): cabeça inclinada + mão no queixo
 *    + bolha de pensamento;
 *  - EMOÇÕES (prop `emotion` = detectEmotion()): feliz / preocupado /
 *    pensativo / neutro;
 *  - ACENO de boas-vindas (prop `wave`) quando o widget abre.
 *
 * Ver Mascot3D.tsx / MascotCharacter.tsx (a MESMA malha da home).
 */

import Mascot3D from './Mascot3D';
import type { MascotEmotion } from '@/lib/mascot-emotions';

export type ChatMascotProps = {
  /** true → a boca mexe-se (resposta da IA a ser revelada no balão). */
  speaking?: boolean;
  /** true → pose «a pensar» (bolha de pensamento + mão no queixo). */
  thinking?: boolean;
  /** Expressão facial — resultado de detectEmotion(). */
  emotion?: MascotEmotion;
  /** true → aceno de boas-vindas (widget acabou de abrir). */
  wave?: boolean;
};

export default function ChatMascot({
  speaking = false,
  thinking = false,
  emotion = 'neutro',
  wave = false,
}: ChatMascotProps) {
  return (
    <Mascot3D
      context="chat"
      isLoggedIn
      speaking={speaking}
      thinking={thinking}
      emotion={emotion}
      wave={wave}
    />
  );
}
