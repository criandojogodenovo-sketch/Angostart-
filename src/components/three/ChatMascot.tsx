'use client';

/**
 * AngoStart — ChatMascot (Fase 23 · assistente virtual 3D no chat).
 *
 * A MESMA mascote da home (paleta + geometria low-poly idênticas — ver
 * mascot-palette.ts), agora em versão «BUSTO» compacta para o widget de
 * chat, com uma camada extra de interatividade sincronizada com a IA:
 *
 *  - LIP SYNC (prop `speaking`): enquanto a resposta da IA está a ser
 *    revelada no balão, a boca abre/fecha a ~11 ciclos/s com variação
 *    natural (dois senos sobrepostos — evita «metrónomo»);
 *  - PENSAR (prop `thinking`): cabeça inclinada, mão no queixo e BOLHA DE
 *    PENSAMENTO (3 esferas ascendentes) acima da cabeça — activo enquanto
 *    o servidor gera a resposta (`isTyping`/`aEnviar`);
 *  - EMOÇÕES (prop `emotion` — detectEmotion(), 0 chamadas de API):
 *      feliz      → sorriso largo + aceno rápido do braço;
 *      preocupado → sobrancelhas franzidas para dentro, olhos semicerrados,
 *                   boca curvada para baixo (∩ — empatia com erros);
 *      pensativo  → sobrancelhas levantadas + olhar para cima + inclinação;
 *      neutro     → sorriso suave (descanso).
 *
 * Performance (as mesmas regras do CTO da Fase 22, aplicadas ao chat):
 *  - Geometria LOW-POLY (esferas/cápsulas 8-24 segmentos), SEM shadow maps,
 *    SEM pós-processamento, dpr limitado a 1.5;
 *  - Canvas minúsculo (~70-100 px) montado APENAS quando o chat está aberto
 *    (o widget desmonta o painel ao fechar → o contexto WebGL é libertado);
 *  - Carregado via next/dynamic (three/R3F ficam em chunk SEPARADO — ver
 *    ChatMascotLoader); sem WebGL → fallback 2D SVG no loader;
 *  - touch-action: pan-y → o canvas nunca captura gestos.
 *
 * A resposta em texto aparece no BALÃO SMS (HTML, fora do canvas) — ver
 * SupportChatWidget (o balão acompanha a boca: revela o texto ao mesmo
 * ritmo a que a mascote «fala»).
 */

import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import type { MascotEmotion } from '@/lib/mascot-emotions';
import { SKIN, SKIN_DARK, SHIRT, SHIRT_DARK, HAIR, DARK } from './mascot-palette';

export type ChatMascotProps = {
  /** true → a boca mexe-se (resposta da IA a ser revelada no balão). */
  speaking?: boolean;
  /** true → pose «a pensar» (bolha de pensamento + mão no queixo). */
  thinking?: boolean;
  /** Expressão facial — resultado de detectEmotion(). */
  emotion?: MascotEmotion;
};

/* Escala Y mínima da boca aberta (quando fechada fica quase invisível). */
const MOUTH_CLOSED = 0.021;

/* ─────────────────────── O boneco (busto — cabeça + ombros) ─────────────────────── */

function ChatCharacter({
  speaking = false,
  thinking = false,
  emotion = 'neutro',
}: ChatMascotProps) {
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const browL = useRef<THREE.Mesh>(null!);
  const browR = useRef<THREE.Mesh>(null!);
  const smile = useRef<THREE.Mesh>(null!);
  const openMouth = useRef<THREE.Mesh>(null!);
  const armR = useRef<THREE.Group>(null!);
  const bubbles = useRef<THREE.Group>(null!);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    /* Factor de amortecimento independente do framerate (~120 ms) */
    const k = 1 - Math.exp(-8 * delta);

    const feliz = emotion === 'feliz';
    const preocupado = emotion === 'preocupado';
    const pensativo = emotion === 'pensativo' || thinking;

    /* Vida: flutuação leve (mais subtil que a home — canvas pequeno) */
    group.current.position.y = 0.03 + Math.sin(t * 1.3) * 0.02;

    /* CABEÇA: inclina quando pensa; baloiço suave sempre; «fala» mexe um
       bocadinho mais (falar com a cabeça = natural). */
    const rotZ = pensativo ? 0.16 : Math.sin(t * 0.8) * 0.03;
    head.current.rotation.z = THREE.MathUtils.lerp(head.current.rotation.z, rotZ, k);
    head.current.rotation.y = THREE.MathUtils.lerp(
      head.current.rotation.y,
      Math.sin(t * 0.6) * 0.06,
      k
    );
    const rotX = speaking ? Math.sin(t * 5.5) * 0.02 : 0;
    head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, rotX, k);

    /* SOBRANCELHAS: preocupado → franzidas para dentro; feliz → levantadas. */
    const browRot = preocupado ? 0.5 : feliz ? 0.05 : 0.14;
    const browY = preocupado ? 0.125 : feliz ? 0.165 : 0.14;
    browL.current.rotation.z = THREE.MathUtils.lerp(browL.current.rotation.z, browRot, k);
    browR.current.rotation.z = THREE.MathUtils.lerp(browR.current.rotation.z, -browRot, k);
    browL.current.position.y = THREE.MathUtils.lerp(browL.current.position.y, browY, k);
    browR.current.position.y = THREE.MathUtils.lerp(browR.current.position.y, browY, k);

    /* OLHOS: semicerrados (preocupado), olhar para cima (pensativo),
       piscar ~3.6 s (vida) — igual à mascote da home. */
    const eyeOpen = preocupado ? 0.55 : 1;
    const phase = t % 3.6;
    const blink = phase < 0.14 ? 0.12 : 1;
    eyes.current.scale.y = eyeOpen * blink;
    const eyeY = pensativo ? 0.055 : 0.03;
    eyes.current.position.y = THREE.MathUtils.lerp(eyes.current.position.y, eyeY, k);

    /* BOCA — LIP SYNC: ~11 aberturas/s com amplitude variável (11.3 Hz
       modulada por 3.1 Hz → não parece robô). */
    let open = 0;
    if (speaking) {
      open = Math.abs(Math.sin(t * 11.3) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.1))));
    }
    const openY = MOUTH_CLOSED + open * 0.13;
    openMouth.current.scale.set(0.09, Math.max(MOUTH_CLOSED, openY), 0.05);

    /* Sorriso (arco de torus): esconde-se enquanto fala; ∪ = sorriso,
       ∩ = tristeza (preocupado — troca instantânea, sem rotação intermédia
       esquisita). */
    const smileScale = speaking ? 0.001 : preocupado ? 0.9 : feliz ? 1.28 : 1;
    smile.current.scale.setScalar(
      THREE.MathUtils.lerp(smile.current.scale.x, smileScale, k)
    );
    smile.current.rotation.z = preocupado ? 0 : Math.PI;
    const smileY = preocupado ? -0.12 : -0.15;
    smile.current.position.y = THREE.MathUtils.lerp(smile.current.position.y, smileY, k);

    /* BRAÇO DIREITO: feliz → ACENO; pensativo → mão no queixo; senão
       descansa junto ao corpo. */
    let armTargetZ = -0.35;
    if (feliz && !speaking && !thinking) armTargetZ = -0.95 + Math.sin(t * 6.2) * 0.35;
    if (pensativo) armTargetZ = 0.85;
    armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, armTargetZ, k * 0.9);
    const armTargetX = pensativo ? -0.5 : 0;
    armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, armTargetX, k * 0.9);

    /* BOLHA DE PENSAMENTO: cresce/encolhe suavemente com o estado. */
    const bubScale = thinking ? 1 : 0.001;
    bubbles.current.scale.setScalar(
      THREE.MathUtils.lerp(bubbles.current.scale.x, bubScale, k)
    );
    bubbles.current.visible = bubbles.current.scale.x > 0.01;
  });

  return (
    <group ref={group} position={[0, 0.03, 0]}>
      {/* Ombros/torso (cápsula afundada — «busto») */}
      <mesh position={[0, 0.18, 0]}>
        <capsuleGeometry args={[0.34, 0.3, 6, 16]} />
        <meshStandardMaterial color={SHIRT} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* Colarinho branco (igual à home) */}
      <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.13, 0.03, 8, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </mesh>
      {/* Selo AngoStart no peito (círculo emissivo) */}
      <mesh position={[0, 0.22, 0.33]}>
        <circleGeometry args={[0.07, 20]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#60a5fa"
          emissiveIntensity={0.35}
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* Braço esquerdo (junto ao corpo) */}
      <group position={[-0.42, 0.4, 0]}>
        <mesh position={[-0.05, -0.16, 0]} rotation={[0, 0, 0.3]}>
          <capsuleGeometry args={[0.08, 0.26, 4, 8]} />
          <meshStandardMaterial color={SHIRT_DARK} roughness={0.55} />
        </mesh>
        <mesh position={[-0.13, -0.32, 0]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
      </group>

      {/* Braço direito (ANIMADO: aceno ↔ mão no queixo ↔ descanso) */}
      <group ref={armR} position={[0.42, 0.4, 0]}>
        <mesh position={[0.05, 0.16, 0]} rotation={[0, 0, -0.25]}>
          <capsuleGeometry args={[0.08, 0.26, 4, 8]} />
          <meshStandardMaterial color={SHIRT_DARK} roughness={0.55} />
        </mesh>
        <mesh position={[0.1, 0.32, 0]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
      </group>

      {/* ── Cabeça (grupo animado — mesma malha da home) ── */}
      <group ref={head} position={[0, 0.85, 0]}>
        {/* Pescoço */}
        <mesh position={[0, -0.28, 0]}>
          <cylinderGeometry args={[0.09, 0.1, 0.14, 10]} />
          <meshStandardMaterial color={SKIN_DARK} roughness={0.6} />
        </mesh>
        {/* Rosto */}
        <mesh>
          <sphereGeometry args={[0.42, 28, 20]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
        {/* Orelhas */}
        <mesh position={[-0.4, 0, 0]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
        <mesh position={[0.4, 0, 0]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
        {/* Cabelo (calota esférica — igual à home, acima das sobrancelhas) */}
        <mesh position={[0, 0.03, 0]} scale={[1.05, 1.03, 1.05]}>
          <sphereGeometry args={[0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>

        {/* Sobrancelhas (animadas pela emoção) */}
        <mesh ref={browL} position={[-0.14, 0.14, 0.38]} rotation={[0, 0, 0.14]}>
          <boxGeometry args={[0.12, 0.03, 0.03]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>
        <mesh ref={browR} position={[0.14, 0.14, 0.38]} rotation={[0, 0, -0.14]}>
          <boxGeometry args={[0.12, 0.03, 0.03]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>

        {/* Olhos (grupo animado: piscar/semicerrar + brilhos — igual à home) */}
        <group ref={eyes} position={[0, 0.03, 0.39]}>
          <mesh position={[-0.14, 0, 0]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color={DARK} roughness={0.3} />
          </mesh>
          <mesh position={[0.14, 0, 0]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color={DARK} roughness={0.3} />
          </mesh>
          <mesh position={[-0.125, 0.016, 0.032]}>
            <sphereGeometry args={[0.013, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0.155, 0.016, 0.032]}>
            <sphereGeometry args={[0.013, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
          </mesh>
        </group>

        {/* BOCA — dois elementos sobrepostos:
            1) arco do sorriso/tristeza (emoção);
            2) boca ABERTA (esfera escalada) para o lip sync. */}
        <mesh ref={smile} position={[0, -0.15, 0.37]} rotation={[0.35, 0, Math.PI]}>
          <torusGeometry args={[0.1, 0.021, 6, 12, Math.PI]} />
          <meshStandardMaterial color="#b4562e" roughness={0.6} />
        </mesh>
        <mesh ref={openMouth} position={[0, -0.15, 0.365]} scale={[0.09, 0.021, 0.05]}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color="#7f1d1d" roughness={0.7} />
        </mesh>

        {/* Bochechas */}
        <mesh position={[-0.25, -0.08, 0.32]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#f1996b" transparent opacity={0.65} roughness={0.8} />
        </mesh>
        <mesh position={[0.25, -0.08, 0.32]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#f1996b" transparent opacity={0.65} roughness={0.8} />
        </mesh>
      </group>

      {/* Bolha de pensamento (3 esferas ascendentes — só `thinking`).
          Indigo claro: visível sobre o fundo BRANCO da faixa do chat. */}
      <group ref={bubbles} scale={[0.001, 0.001, 0.001]}>
        <mesh position={[-0.33, 1.13, 0.12]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshBasicMaterial color="#a5b4fc" transparent opacity={0.85} />
        </mesh>
        <mesh position={[-0.44, 1.24, 0.12]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshBasicMaterial color="#a5b4fc" transparent opacity={0.9} />
        </mesh>
        <Float speed={2.2} rotationIntensity={0.1} floatIntensity={0.5} floatingRange={[-0.04, 0.04]}>
          <mesh position={[-0.58, 1.4, 0.08]}>
            <sphereGeometry args={[0.08, 12, 10]} />
            <meshBasicMaterial color="#c7d2fe" transparent opacity={0.95} />
          </mesh>
        </Float>
      </group>
    </group>
  );
}

/* ─────────────────── Câmara responsiva (enquadra o busto) ─────────────────── */

/**
 * Afasta a câmara quando a BOLHA DE PENSAMENTO está activa (precisa de ar
 * acima da cabeça) e aproxima nos restantes estados; ecrãs estreitos
 * (mobile) afastam um pouco mais para a mão que acena nunca sair do quadro.
 */
function CameraRig({ thinking }: { thinking: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const z = thinking ? (aspect < 0.9 ? 3.4 : 3.0) : aspect < 0.9 ? 3.0 : 2.6;
    const y = thinking ? 0.95 : 0.78;
    camera.position.set(0, y, z);
    camera.lookAt(0, y, 0);
  }, [camera, size, thinking]);
  return null;
}

/* ─────────────────────── Cena (Canvas) ─────────────────────── */

export default function ChatMascot({
  speaking = false,
  thinking = false,
  emotion = 'neutro',
}: ChatMascotProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.78, 2.6], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent', touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      <CameraRig thinking={thinking} />
      {/* Iluminação igual à home: chave + preenchimento + rim colorido */}
      <ambientLight intensity={1.0} />
      <directionalLight position={[3, 4, 5]} intensity={2.0} />
      <pointLight position={[-3, 2.5, -2]} intensity={10} color="#7c3aed" />
      <pointLight position={[3, 0, 2.5]} intensity={6} color="#38bdf8" />

      <ChatCharacter speaking={speaking} thinking={thinking} emotion={emotion} />
    </Canvas>
  );
}
