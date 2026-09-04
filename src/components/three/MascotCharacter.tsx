'use client';

/**
 * AngoStart — MascotCharacter (Fase 24 · «cartoon 3D premium»).
 *
 * O personagem REFINADO da AngoStart, desenhado a partir das referências
 * (rapaz de óculos + barba + sorriso com dentes, camisa com botões e
 * smartwatch) e reutilizado em TODAS as áreas do site:
 *
 *   HOME       → Avatar3D (cena com pódio + elementos de comércio);
 *   CHAT de IA → ChatMascot (busto com lip sync + emoções);
 *   PAINEL     → DashboardMascot (versão pequena que reage aos dados);
 *   e como componente canónico → Mascot3D (context: home|chat|dashboard).
 *
 * Visual (refs. imagem 1 e 2 — NADA infantil):
 *  - Cabeça adulta: cabelo escuro estilo (volume + franja varrida),
 *    BARBA definida (faixa inferior + bigode + suíças ligadas ao cabelo),
 *    sorriso natural com DENTES visíveis, nariz, sobrancelhas grossas;
 *  - Olhos com esclera + íris castanha + brilho (muito mais «vivo»);
 *  - Óculos de VIDRO: meshPhysicalMaterial com `transmission` (refração
 *    real) + aros escuros metálicos + gesto de empurrar os óculos;
 *  - Corpo proporcional: ombros, braços com COTOVELO, antebraços à mostra
 *    (mangas dobradas), MÃOS COM DEDOS (palma + 4 dedos + polegar),
 *    postura natural; camisa índigo-violeta (a «roxa» premium da ref. 2)
 *    com colarinho, PALA de botões (4 botões), crachá no peito (ref. 2)
 *    e SMARTWATCH no pulso esquerdo (ref. 1/2);
 *  - Materiais MeshStandardMaterial (pele/tecido/cabelo) + env map do
 *    `Environment` (estúdio de Lightformers — offline, SEM downloads HDR)
 *    para reflexos subtis.
 *
 * Rig de animação (por contexto):
 *  - Flutuação suave; na home roda a seguir o ponteiro;
 *  - ACENO contínuo na home; aceno de boas-vindas no chat (`wave`) e
 *    quando feliz/reage positivo;
 *  - LIP SYNC (boca abre/fecha ~11 Hz modulada — nada de metrónomo);
 *  - PENSAR: cabeça inclinada + olhar para cima + mão no queixo + bolha
 *    de pensamento;
 *  - EMOÇÕES (detectEmotion / mood): feliz → sorriso largo + sobrancelhas
 *    levantadas; preocupado → sobrancelhas em V + olhos semicerrados +
 *    boca ∩ (dentes escondidos); pensativo → sobrancelhas altas.
 *
 * Performance (regras do CTO — mantidas da Fase 22):
 *  - LOW-POLY (esferas 8-32 segmentos), SEM shadow maps (ContactShadows
 *    só na home), SEM pós-processamento, dpr ≤ 1.5;
 *  - Sempre dentro de chunk lazy (next/dynamic — ver loaders);
 *  - touch-action: pan-y definido no Canvas (não captura gestos).
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Float, Lightformer, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { MascotEmotion } from '@/lib/mascot-emotions';
import {
  BEARD,
  BUTTON,
  DARK,
  EYES_IRIS,
  FRAME,
  HAIR,
  INNER_MOUTH,
  LIPS,
  SHIRT,
  SHIRT_DARK,
  SKIN,
  SKIN_DARK,
  SKIN_NOSE,
  TEETH,
  WATCH_SCREEN,
} from './mascot-palette';

/* ─────────────────────── Tipos (componente Mascot3D reutilizável) ─────────────────────── */

export type MascotContext = 'home' | 'chat' | 'dashboard';

/** Reacção da mascote do painel aos dados (não inventa valores). */
export type MascotMood = 'neutral' | 'positive' | 'alert';

export type Mascot3DProps = {
  /** Área do site — muda enquadramento, pose e acessórios. */
  context?: MascotContext;
  /** Home: autenticado → óculos (visitante SEM óculos, ref. spec). */
  isLoggedIn?: boolean;
  /** CHAT: boca mexe-se enquanto a resposta é revelada. */
  speaking?: boolean;
  /** CHAT: pose «a pensar» (isTyping — mão no queixo + bolha). */
  thinking?: boolean;
  /** CHAT: aceno de boas-vindas ao abrir o widget. */
  wave?: boolean;
  /** CHAT: expressão — resultado de detectEmotion(). */
  emotion?: MascotEmotion;
  /** PAINEL: humor derivado dos dados do dashboard. */
  mood?: MascotMood;
};

/* ─────────────────────── Iluminação de estúdio (partilhada) ─────────────────────── */

/**
 * Luz principal quente + preenchimento + rim roxo/azul (marca) e um
 * `Environment` de Lightformers renderizado LOCALMENTE (resolução 64,
 * frames:1) — reflexos subtis nos óculos/smartwatch SEM descarregar HDRs
 * externos (funciona offline e em qualquer rede).
 */
export function MascotStage() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3.5, 5, 4]} intensity={1.6} color="#fff2e6" />
      <pointLight position={[-3, 2.5, -2]} intensity={9} color="#7c3aed" />
      <pointLight position={[3, -1, 2.5]} intensity={4.5} color="#38bdf8" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 2]} scale={[9, 4, 1]} color="#ffffff" />
        <Lightformer
          form="rect"
          intensity={1.1}
          position={[-4, 1.5, 2]}
          rotation-y={Math.PI / 3}
          scale={[4, 6, 1]}
          color="#c7d2fe"
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          position={[4, 1, 1]}
          rotation-y={-Math.PI / 3}
          scale={[4, 6, 1]}
          color="#99f6e4"
        />
        <Lightformer form="ring" intensity={1.4} position={[2, 3.5, -2]} scale={2.5} color="#818cf8" />
      </Environment>
    </>
  );
}

/* ─────────────────────── Mão (palma + 4 dedos + polegar) ─────────────────────── */

function Hand({ side }: { side: 1 | -1 }) {
  return (
    <group>
      {/* Palma */}
      <RoundedBox args={[0.07, 0.085, 0.05]} radius={0.02} smoothness={3}>
        <meshStandardMaterial color={SKIN} roughness={0.55} />
      </RoundedBox>
      {/* Dedos (apontam para cima — braço erguido) */}
      {[-0.024, -0.008, 0.008, 0.024].map((x) => (
        <mesh key={x} position={[x, 0.062, 0.004]}>
          <capsuleGeometry args={[0.0145, 0.05, 3, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
      ))}
      {/* Polegar (lado interior da mão) */}
      <mesh position={[-0.05 * side, 0.018, 0.014]} rotation={[0, 0, 0.65 * side]}>
        <capsuleGeometry args={[0.016, 0.042, 3, 8]} />
        <meshStandardMaterial color={SKIN} roughness={0.55} />
      </mesh>
    </group>
  );
}

/* ─────────────────────── O personagem (grupo animado) ─────────────────────── */

export function Mascot3DCharacter({
  context = 'home',
  isLoggedIn = false,
  speaking = false,
  thinking = false,
  wave = false,
  emotion = 'neutro',
  mood = 'neutral',
}: Mascot3DProps) {
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const browL = useRef<THREE.Mesh>(null!);
  const browR = useRef<THREE.Mesh>(null!);
  const glasses = useRef<THREE.Group>(null!);
  const smile = useRef<THREE.Mesh>(null!);
  const teeth = useRef<THREE.Group>(null!);
  const innerMouth = useRef<THREE.Mesh>(null!);
  const armR = useRef<THREE.Group>(null!);
  const bubbles = useRef<THREE.Group>(null!);

  /* Óculos: chat/painel mostram-nos sempre (persona do assistente,
     ref. imagem 1); na home só quando autenticado (spec Fase 24). */
  const showGlasses = context === 'home' ? isLoggedIn : true;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    /* Factor de amortecimento independente do framerate (~120 ms). */
    const k = 1 - Math.exp(-8 * delta);
    const lerp = THREE.MathUtils.lerp;

    /* Emoção efectiva: no painel vem do `mood` (dados), no chat do
       detectEmotion(). */
    const emo: MascotEmotion =
      context === 'dashboard'
        ? mood === 'positive'
          ? 'feliz'
          : mood === 'alert'
            ? 'preocupado'
            : 'neutro'
        : emotion;
    const feliz = emo === 'feliz';
    const preocupado = emo === 'preocupado';
    const pensativo = emo === 'pensativo' || thinking;

    /* Flutuação (mais subtil no chat — canvas pequeno). */
    const amp = context === 'chat' ? 0.02 : 0.045;
    group.current.position.y = (context === 'home' ? 0.06 : 0.03) + Math.sin(t * 1.3) * amp;

    /* Home: roda suavemente a seguir o ponteiro (cena interativa). */
    if (context === 'home') {
      group.current.rotation.y = lerp(group.current.rotation.y, state.pointer.x * 0.5, 0.07);
      group.current.rotation.x = lerp(group.current.rotation.x, -state.pointer.y * 0.1, 0.07);
    }

    /* Aceno: contínuo na home; boas-vindas no chat; feliz/positivo. */
    const waving = context === 'home' || wave || (feliz && !speaking && !thinking);

    /* BRAÇO DIREITO (expressivo): aceno ↔ mão no queixo ↔ descanso. */
    let armZ = -0.32;
    let armX = -0.06;
    if (pensativo) {
      armZ = 0.85;
      armX = -0.5;
    } else if (waving) {
      armZ = -1.05 + Math.sin(t * 5.4) * 0.4;
      armX = 0;
    }
    armR.current.rotation.z = lerp(armR.current.rotation.z, armZ, k * 0.9);
    armR.current.rotation.x = lerp(armR.current.rotation.x, armX, k * 0.9);

    /* CABEÇA: inclina quando pensa; baloiço suave; «fala» mexe-a. */
    const rotZ = pensativo ? 0.16 : Math.sin(t * 0.8) * 0.03;
    head.current.rotation.z = lerp(head.current.rotation.z, rotZ, k);
    head.current.rotation.y = lerp(head.current.rotation.y, Math.sin(t * 0.6) * 0.06, k);
    const rotX = speaking ? Math.sin(t * 5.5) * 0.02 : 0;
    head.current.rotation.x = lerp(head.current.rotation.x, rotX, k);

    /* SOBRANCELHAS: preocupado → franzidas para dentro; feliz → altas. */
    const browRot = preocupado ? 0.5 : feliz ? 0.05 : 0.14;
    const browY = preocupado ? 0.125 : feliz ? 0.168 : 0.148;
    browL.current.rotation.z = lerp(browL.current.rotation.z, browRot, k);
    browR.current.rotation.z = lerp(browR.current.rotation.z, -browRot, k);
    browL.current.position.y = lerp(browL.current.position.y, browY, k);
    browR.current.position.y = lerp(browR.current.position.y, browY, k);

    /* OLHOS: semicerrados (preocupado), olhar para cima (pensativo),
       piscar ~3.6 s (vida). */
    const eyeOpen = preocupado ? 0.55 : 1;
    const phase = t % 3.6;
    const blink = phase < 0.14 ? 0.12 : 1;
    eyes.current.scale.y = eyeOpen * blink;
    const eyeY = pensativo ? 0.058 : 0.03;
    eyes.current.position.y = lerp(eyes.current.position.y, eyeY, k);

    /* BOCA — LIP SYNC: ~11 aberturas/s com amplitude variável.
       Dentes ficam fixos (maxilar superior); a boca interna é que abre. */
    let open = 0;
    if (speaking) {
      open = Math.abs(Math.sin(t * 11.3) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.1))));
    }
    innerMouth.current.scale.y = 0.05 + open * 0.15;

    /* Dentes: escondem-se quando preocupado (∩ sem dentes). */
    const teethScale = preocupado ? 0.001 : feliz ? 1.12 : 1;
    teeth.current.scale.setScalar(lerp(teeth.current.scale.x, teethScale, k));

    /* Lábios (arco): ∪ sorriso (escondem-se ao falar) / ∩ preocupado. */
    const smileScale = speaking ? 0.001 : preocupado ? 0.9 : feliz ? 1.28 : 1;
    smile.current.scale.setScalar(lerp(smile.current.scale.x, smileScale, k));
    smile.current.rotation.z = preocupado ? 0 : Math.PI;
    smile.current.position.y = lerp(smile.current.position.y, preocupado ? -0.125 : -0.158, k);

    /* Gesto de «empurrar os óculos» (~a cada 5.2 s, com óculos). */
    if (showGlasses) {
      const adj = (t + 1.4) % 5.2;
      const g = adj < 0.7 ? Math.sin((adj / 0.7) * Math.PI) : 0;
      glasses.current.position.y = 0.035 + g * 0.04;
      glasses.current.rotation.x = -0.05 - g * 0.24;
      head.current.rotation.z += g * 0.05;
    }

    /* BOLHA DE PENSAMENTO (chat): cresce/encolhe suavemente. */
    const bubScale = thinking ? 1 : 0.001;
    bubbles.current.scale.setScalar(lerp(bubbles.current.scale.x, bubScale, k));
    bubbles.current.visible = bubbles.current.scale.x > 0.01;
  });

  return (
    <group ref={group} position={[0, context === 'home' ? 0.06 : 0.03, 0]}>
      {/* ══════════ TORSO — camisa índigo com botões, gola e crachá ══════════ */}
      <mesh position={[0, 0.3, 0]}>
        <capsuleGeometry args={[0.33, 0.34, 6, 20]} />
        <meshStandardMaterial color={SHIRT} roughness={0.5} metalness={0.04} />
      </mesh>
      {/* Ombros arredondados */}
      <mesh position={[-0.3, 0.52, 0]}>
        <sphereGeometry args={[0.14, 14, 10]} />
        <meshStandardMaterial color={SHIRT} roughness={0.5} />
      </mesh>
      <mesh position={[0.3, 0.52, 0]}>
        <sphereGeometry args={[0.14, 14, 10]} />
        <meshStandardMaterial color={SHIRT} roughness={0.5} />
      </mesh>
      {/* T-shirt branca por baixo da camisa aberta */}
      <RoundedBox args={[0.11, 0.14, 0.03]} radius={0.012} smoothness={2} position={[0, 0.55, 0.285]}>
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </RoundedBox>
      {/* Palas do colarinho */}
      <RoundedBox
        args={[0.14, 0.062, 0.03]}
        radius={0.012}
        smoothness={2}
        position={[-0.095, 0.6, 0.3]}
        rotation={[0, 0.25, 0.5]}
      >
        <meshStandardMaterial color={SHIRT_DARK} roughness={0.45} />
      </RoundedBox>
      <RoundedBox
        args={[0.14, 0.062, 0.03]}
        radius={0.012}
        smoothness={2}
        position={[0.095, 0.6, 0.3]}
        rotation={[0, -0.25, -0.5]}
      >
        <meshStandardMaterial color={SHIRT_DARK} roughness={0.45} />
      </RoundedBox>
      {/* Palas de botões + 4 botões */}
      <RoundedBox args={[0.12, 0.4, 0.025]} radius={0.01} smoothness={2} position={[0, 0.38, 0.318]}>
        <meshStandardMaterial color={SHIRT_DARK} roughness={0.45} />
      </RoundedBox>
      {[0.2, 0.31, 0.42, 0.53].map((y) => (
        <mesh key={y} position={[0, y, 0.332]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.014, 10]} />
          <meshStandardMaterial color={BUTTON} roughness={0.35} metalness={0.35} />
        </mesh>
      ))}
      {/* Crachá (ref. imagem 2 — cartão preso no peito) */}
      <group position={[0.18, 0.44, 0.335]}>
        <RoundedBox args={[0.078, 0.058, 0.014]} radius={0.008} smoothness={2}>
          <meshStandardMaterial color="#f8fafc" roughness={0.3} />
        </RoundedBox>
        <mesh position={[0, 0.012, 0.009]}>
          <boxGeometry args={[0.078, 0.014, 0.004]} />
          <meshStandardMaterial color="#3b82f6" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.036, 0.004]}>
          <boxGeometry args={[0.03, 0.014, 0.012]} />
          <meshStandardMaterial color={DARK} roughness={0.35} metalness={0.4} />
        </mesh>
      </group>

      {/* ══════════ BRAÇO ESQUERDO (descanso + smartwatch) ══════════ */}
      <group position={[-0.33, 0.52, 0]}>
        {/* Manga até ao cotovelo (manga dobrada — antebraço à mostra) */}
        <mesh position={[-0.05, 0.17, 0]} rotation={[0, 0, 0.18]}>
          <capsuleGeometry args={[0.088, 0.22, 4, 10]} />
          <meshStandardMaterial color={SHIRT} roughness={0.5} />
        </mesh>
        <mesh position={[-0.075, 0.33, 0.005]}>
          <sphereGeometry args={[0.075, 12, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        {/* Antebraço (pele) */}
        <mesh position={[-0.09, 0.45, 0.015]} rotation={[0, 0, 0.12]}>
          <capsuleGeometry args={[0.068, 0.2, 4, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        {/* SMARTWATCH (ref. — pulso esquerdo): bracelete + ecrã emissivo */}
        <mesh position={[-0.093, 0.545, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.062, 0.02, 8, 18]} />
          <meshStandardMaterial color={DARK} roughness={0.4} metalness={0.5} />
        </mesh>
        <RoundedBox args={[0.05, 0.036, 0.024]} radius={0.007} smoothness={2} position={[-0.148, 0.545, 0.02]}>
          <meshStandardMaterial
            color={WATCH_SCREEN}
            emissive={WATCH_SCREEN}
            emissiveIntensity={0.9}
            roughness={0.2}
            toneMapped={false}
          />
        </RoundedBox>
        {/* Mão com dedos */}
        <group position={[-0.1, 0.6, 0.04]}>
          <Hand side={-1} />
        </group>
      </group>

      {/* ══════════ BRAÇO DIREITO (expressivo: aceno ↔ queixo) ══════════ */}
      <group ref={armR} position={[0.33, 0.52, 0]}>
        <mesh position={[0.05, 0.17, 0]} rotation={[0, 0, -0.18]}>
          <capsuleGeometry args={[0.088, 0.22, 4, 10]} />
          <meshStandardMaterial color={SHIRT} roughness={0.5} />
        </mesh>
        <mesh position={[0.075, 0.33, 0.005]}>
          <sphereGeometry args={[0.075, 12, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        <mesh position={[0.09, 0.45, 0.015]} rotation={[0, 0, -0.12]}>
          <capsuleGeometry args={[0.068, 0.2, 4, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        <group position={[0.1, 0.6, 0.04]}>
          <Hand side={1} />
        </group>
      </group>

      {/* ══════════ CABEÇA (grupo animado) ══════════ */}
      <group ref={head} position={[0, 1.02, 0]}>
        {/* Pescoço */}
        <mesh position={[0, -0.31, 0.01]}>
          <cylinderGeometry args={[0.085, 0.1, 0.16, 12]} />
          <meshStandardMaterial color={SKIN_DARK} roughness={0.6} />
        </mesh>
        {/* Rosto */}
        <mesh>
          <sphereGeometry args={[0.42, 32, 24]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        {/* Orelhas */}
        <mesh position={[-0.405, 0, 0]}>
          <sphereGeometry args={[0.075, 10, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        <mesh position={[0.405, 0, 0]}>
          <sphereGeometry args={[0.075, 10, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        {/* Nariz */}
        <mesh position={[0, -0.045, 0.4]} scale={[1, 1.3, 1.1]}>
          <sphereGeometry args={[0.052, 12, 10]} />
          <meshStandardMaterial color={SKIN_NOSE} roughness={0.55} />
        </mesh>

        {/* Cabelo escuro com styling: calota + volume + franja + suíças */}
        <mesh position={[0, 0.02, 0]} scale={[1.02, 1.03, 1.02]}>
          <sphereGeometry args={[0.44, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.37]} />
          <meshStandardMaterial color={HAIR} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.27, -0.04]} scale={[1.32, 0.62, 1.18]}>
          <sphereGeometry args={[0.29, 20, 14]} />
          <meshStandardMaterial color={HAIR} roughness={0.45} />
        </mesh>
        <mesh position={[0.03, 0.26, 0.24]} rotation={[-0.7, 0, 0.15]}>
          <capsuleGeometry args={[0.082, 0.18, 4, 10]} />
          <meshStandardMaterial color={HAIR} roughness={0.45} />
        </mesh>
        {/* Suíças (ligam o cabelo à barba) */}
        <mesh position={[-0.372, -0.045, 0.1]}>
          <boxGeometry args={[0.05, 0.17, 0.09]} />
          <meshStandardMaterial color={BEARD} roughness={0.5} />
        </mesh>
        <mesh position={[0.372, -0.045, 0.1]}>
          <boxGeometry args={[0.05, 0.17, 0.09]} />
          <meshStandardMaterial color={BEARD} roughness={0.5} />
        </mesh>

        {/* BARBA definida: faixa inferior + bigode (ref. imagens 1/2) */}
        <mesh position={[0, -0.01, 0.005]} scale={[1.01, 1.02, 1.01]}>
          <sphereGeometry args={[0.45, 28, 18, 0, Math.PI * 2, Math.PI * 0.575, Math.PI * 0.38]} />
          <meshStandardMaterial color={BEARD} roughness={0.5} />
        </mesh>
        <RoundedBox args={[0.17, 0.045, 0.05]} radius={0.015} smoothness={2} position={[0, -0.108, 0.395]}>
          <meshStandardMaterial color={BEARD} roughness={0.5} />
        </RoundedBox>

        {/* Sobrancelhas grossas (animadas pela emoção) */}
        <mesh ref={browL} position={[-0.15, 0.148, 0.385]} rotation={[0, 0, 0.14]}>
          <boxGeometry args={[0.13, 0.038, 0.038]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>
        <mesh ref={browR} position={[0.15, 0.148, 0.385]} rotation={[0, 0, -0.14]}>
          <boxGeometry args={[0.13, 0.038, 0.038]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>

        {/* OLHOS premium: esclera + íris castanha + brilho */}
        <group ref={eyes} position={[0, 0.03, 0.375]}>
          <mesh position={[-0.15, 0, 0]}>
            <sphereGeometry args={[0.05, 14, 10]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.25} />
          </mesh>
          <mesh position={[0.15, 0, 0]}>
            <sphereGeometry args={[0.05, 14, 10]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.25} />
          </mesh>
          <mesh position={[-0.15, 0, 0.03]}>
            <sphereGeometry args={[0.028, 10, 8]} />
            <meshStandardMaterial color={EYES_IRIS} roughness={0.2} />
          </mesh>
          <mesh position={[0.15, 0, 0.03]}>
            <sphereGeometry args={[0.028, 10, 8]} />
            <meshStandardMaterial color={EYES_IRIS} roughness={0.2} />
          </mesh>
          <mesh position={[-0.135, 0.016, 0.048]}>
            <sphereGeometry args={[0.011, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0.165, 0.016, 0.048]}>
            <sphereGeometry args={[0.011, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
          </mesh>
        </group>

        {/* BOCA — dentes visíveis + boca interna (lip sync) + lábios */}
        <group ref={teeth}>
          {[-0.054, -0.018, 0.018, 0.054].map((x) => (
            <mesh key={x} position={[x, -0.152, 0.425]}>
              <boxGeometry args={[0.032, 0.05, 0.045]} />
              <meshStandardMaterial color={TEETH} roughness={0.15} />
            </mesh>
          ))}
        </group>
        <mesh ref={innerMouth} position={[0, -0.19, 0.418]} scale={[1, 0.05, 1]}>
          <boxGeometry args={[0.148, 1, 0.042]} />
          <meshStandardMaterial color={INNER_MOUTH} roughness={0.7} />
        </mesh>
        <mesh ref={smile} position={[0, -0.158, 0.432]} rotation={[0.3, 0, Math.PI]}>
          <torusGeometry args={[0.085, 0.016, 8, 16, Math.PI]} />
          <meshStandardMaterial color={LIPS} roughness={0.55} />
        </mesh>

        {/* ÓCULOS DE VIDRO (transmission — refração real) */}
        {showGlasses && (
          <group ref={glasses} position={[0, 0.035, 0.435]}>
            {/* Aros metálicos escuros */}
            <mesh position={[-0.15, 0, 0]}>
              <torusGeometry args={[0.098, 0.014, 10, 24]} />
              <meshStandardMaterial color={FRAME} metalness={0.75} roughness={0.28} />
            </mesh>
            <mesh position={[0.15, 0, 0]}>
              <torusGeometry args={[0.098, 0.014, 10, 24]} />
              <meshStandardMaterial color={FRAME} metalness={0.75} roughness={0.28} />
            </mesh>
            {/* Lentes de VIDRO: MeshPhysicalMaterial + transmission
                (refração) E blending transparente — os olhos ficam
                SEMPRE visíveis através do vidro, com reflexos do estúdio. */}
            <mesh position={[-0.15, 0, 0.006]}>
              <circleGeometry args={[0.088, 24]} />
              <meshPhysicalMaterial
                color="#dfeaff"
                transmission={0.9}
                thickness={0.03}
                roughness={0.05}
                ior={1.4}
                clearcoat={1}
                clearcoatRoughness={0.06}
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh position={[0.15, 0, 0.006]}>
              <circleGeometry args={[0.088, 24]} />
              <meshPhysicalMaterial
                color="#dfeaff"
                transmission={0.9}
                thickness={0.03}
                roughness={0.05}
                ior={1.4}
                clearcoat={1}
                clearcoatRoughness={0.06}
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Ponte + hastes até às orelhas */}
            <mesh position={[0, 0.028, 0]}>
              <boxGeometry args={[0.09, 0.02, 0.02]} />
              <meshStandardMaterial color={FRAME} metalness={0.75} roughness={0.28} />
            </mesh>
            <mesh position={[-0.27, 0.01, -0.08]} rotation={[0, 0.42, 0]}>
              <boxGeometry args={[0.018, 0.018, 0.28]} />
              <meshStandardMaterial color={FRAME} metalness={0.75} roughness={0.28} />
            </mesh>
            <mesh position={[0.27, 0.01, -0.08]} rotation={[0, -0.42, 0]}>
              <boxGeometry args={[0.018, 0.018, 0.28]} />
              <meshStandardMaterial color={FRAME} metalness={0.75} roughness={0.28} />
            </mesh>
          </group>
        )}
      </group>

      {/* Bolha de pensamento (chat — 3 esferas ascendentes, indigo) */}
      <group ref={bubbles} scale={[0.001, 0.001, 0.001]}>
        <mesh position={[-0.38, 1.42, 0.12]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshBasicMaterial color="#a5b4fc" transparent opacity={0.85} />
        </mesh>
        <mesh position={[-0.5, 1.55, 0.12]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshBasicMaterial color="#a5b4fc" transparent opacity={0.9} />
        </mesh>
        <Float speed={2.2} rotationIntensity={0.1} floatIntensity={0.5} floatingRange={[-0.04, 0.04]}>
          <mesh position={[-0.66, 1.72, 0.08]}>
            <sphereGeometry args={[0.08, 12, 10]} />
            <meshBasicMaterial color="#c7d2fe" transparent opacity={0.95} />
          </mesh>
        </Float>
      </group>
    </group>
  );
}
