'use client';

/**
 * AngoStart — Mascot3D (Fase 24 · componente reutilizável).
 *
 * O MESMO personagem (Mascot3DCharacter — ver MascotCharacter.tsx) em
 * QUALQUER área do site, controlado por duas props:
 *
 *   <Mascot3D context="home"      isLoggedIn={…} />   → cena completa da
 *     home: pódio + anel emissivo + ContactShadows + elementos flutuantes
 *     (visitante: telemóvel/sacola/moeda/gema · logado: gráfico/cartão/moeda);
 *   <Mascot3D context="chat"      speaking thinking emotion wave /> → busto
 *     sincronizado com a IA (lip sync + emoções + bolha de pensamento);
 *   <Mascot3D context="dashboard" mood /> → versão pequena que flutua e
 *     reage aos dados do painel de vendas.
 *
 * Performance: dpr ≤ 1.5, sem pós-processamento, contact shadow só na home
 * (resolução 256 — passe barato), touch-action: pan-y (nunca bloqueia o
 * scroll), sempre atrás de chunk lazy (next/dynamic — ver Mascot3DLoader).
 * Visitante → SEM óculos (postura aberta a acenar); logado/chat/painel →
 * COM óculos (persona do assistente, ref. imagem 1).
 */

import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Float, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { Mascot3DCharacter, MascotStage, type Mascot3DProps } from './MascotCharacter';
import { DARK, SHIRT } from './mascot-palette';

export type { Mascot3DProps, MascotContext, MascotMood } from './MascotCharacter';

/* ─────────────────── Elementos flutuantes — VISITANTE (comércio) ─────────────────── */

function Phone3D() {
  const ref = useRef<THREE.Group>(null!);
  useFrame((s) => {
    ref.current.rotation.y = 0.35 + Math.sin(s.clock.elapsedTime * 0.7) * 0.45;
  });
  return (
    <group position={[-0.98, 0.42, 0.28]}>
      <Float speed={2} rotationIntensity={0.3} floatIntensity={0.9} floatingRange={[-0.07, 0.07]}>
        <group ref={ref} rotation={[0.1, 0.3, -0.06]}>
          <RoundedBox args={[0.36, 0.64, 0.05]} radius={0.05} smoothness={3}>
            <meshStandardMaterial color={DARK} metalness={0.5} roughness={0.35} />
          </RoundedBox>
          <mesh position={[0, 0.03, 0.028]}>
            <planeGeometry args={[0.3, 0.52]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#38bdf8"
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.2, 0.031]}>
            <planeGeometry args={[0.22, 0.07]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.7}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[-0.06, 0.04, 0.031]}>
            <planeGeometry args={[0.14, 0.1]} />
            <meshStandardMaterial
              color="#818cf8"
              emissive="#818cf8"
              emissiveIntensity={0.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      </Float>
    </group>
  );
}

function ShoppingBag3D() {
  return (
    <group position={[1.02, 0.68, -0.3]}>
      <Float speed={1.6} rotationIntensity={0.4} floatIntensity={1} floatingRange={[-0.09, 0.09]}>
        <RoundedBox args={[0.36, 0.3, 0.22]} radius={0.04} smoothness={3}>
          <meshStandardMaterial color="#14b8a6" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.16, 0]}>
          <torusGeometry args={[0.09, 0.014, 6, 14, Math.PI]} />
          <meshStandardMaterial color="#0d9488" roughness={0.5} />
        </mesh>
      </Float>
    </group>
  );
}

function Coin3D() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    ref.current.rotation.y = s.clock.elapsedTime * 1.6;
  });
  return (
    <group position={[-0.85, -0.3, 0.15]} rotation={[0.35, 0, 0]}>
      <Float speed={2.4} rotationIntensity={0.5} floatIntensity={1.2} floatingRange={[-0.08, 0.08]}>
        <mesh ref={ref}>
          <cylinderGeometry args={[0.13, 0.13, 0.03, 20]} />
          <meshStandardMaterial
            color="#f59e0b"
            metalness={0.75}
            roughness={0.25}
            emissive="#f59e0b"
            emissiveIntensity={0.2}
          />
        </mesh>
      </Float>
    </group>
  );
}

function Gem3D() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    ref.current.rotation.y = s.clock.elapsedTime * 1.1;
    ref.current.rotation.x = 0.4 + Math.sin(s.clock.elapsedTime * 0.8) * 0.2;
  });
  return (
    <group position={[0.95, 1.08, -0.35]}>
      <Float speed={1.8} rotationIntensity={0.2} floatIntensity={1} floatingRange={[-0.06, 0.06]}>
        <mesh ref={ref}>
          <octahedronGeometry args={[0.12]} />
          <meshStandardMaterial
            color="#818cf8"
            emissive="#818cf8"
            emissiveIntensity={0.55}
            metalness={0.3}
            roughness={0.25}
          />
        </mesh>
      </Float>
    </group>
  );
}

/* ─────────────────── Elementos flutuantes — LOGADO (dados) ─────────────────── */

function MiniChart3D() {
  const bars: Array<[number, string]> = [
    [0.16, '#60a5fa'],
    [0.26, '#3b82f6'],
    [0.36, '#8b5cf6'],
  ];
  return (
    <group position={[0.98, 0.55, -0.2]}>
      <Float speed={1.8} rotationIntensity={0.12} floatIntensity={0.85} floatingRange={[-0.06, 0.06]}>
        {bars.map(([h, c], i) => (
          <RoundedBox
            key={i}
            args={[0.11, h, 0.06]}
            radius={0.02}
            smoothness={2}
            position={[i * 0.15 - 0.15, h / 2 - 0.12, 0]}
          >
            <meshStandardMaterial color={c} roughness={0.4} />
          </RoundedBox>
        ))}
        <RoundedBox args={[0.52, 0.03, 0.09]} radius={0.012} smoothness={2} position={[0, -0.15, 0]}>
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
        </RoundedBox>
      </Float>
    </group>
  );
}

function Card3D() {
  return (
    <group position={[-1.0, 0.62, -0.22]} rotation={[0, 0.5, 0]}>
      <Float speed={1.4} rotationIntensity={0.35} floatIntensity={0.9} floatingRange={[-0.08, 0.08]}>
        <RoundedBox args={[0.38, 0.26, 0.03]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color="#f8fafc" roughness={0.35} />
        </RoundedBox>
        <RoundedBox args={[0.13, 0.1, 0.02]} radius={0.015} smoothness={2} position={[0, 0.05, 0.02]}>
          <meshStandardMaterial color={SHIRT} roughness={0.4} />
        </RoundedBox>
        <mesh position={[-0.09, -0.05, 0.02]}>
          <boxGeometry args={[0.14, 0.016, 0.01]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.5} />
        </mesh>
        <mesh position={[-0.05, -0.085, 0.02]}>
          <boxGeometry args={[0.1, 0.014, 0.01]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
        </mesh>
      </Float>
    </group>
  );
}

/* ─────────────────── Pódio da home ─────────────────── */

function Podium() {
  return (
    <>
      <mesh position={[0, -0.31, 0]}>
        <cylinderGeometry args={[0.42, 0.47, 0.1, 24]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.255, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.012, 8, 40]} />
        <meshStandardMaterial
          color="#60a5fa"
          emissive="#60a5fa"
          emissiveIntensity={2.4}
          toneMapped={false}
        />
      </mesh>
      {/* Sombra suave (ContactShadows — passe barato, SEM shadow maps) */}
      <ContactShadows
        position={[0, -0.245, 0]}
        opacity={0.5}
        scale={0.95}
        blur={2.4}
        far={1.3}
        resolution={256}
        color="#060a14"
      />
    </>
  );
}

/* ─────────────────── Câmaras responsivas (nunca sai do ecrã) ─────────────────── */

/** HOME: enquadra a cena completa (cabeça ~1.5 + elementos ±1.15 + pódio). */
function HomeCameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const z = aspect < 1.15 ? 5.4 : aspect < 1.6 ? 4.6 : 4.2;
    camera.position.set(0, 0.55, z);
    camera.lookAt(0, 0.55, 0);
  }, [camera, size]);
  return null;
}

/** CHAT: busto; afasta quando a BOLHA DE PENSAMENTO está activa. */
function ChatCameraRig({ thinking }: { thinking: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const z = thinking ? (aspect < 0.9 ? 3.3 : 2.9) : aspect < 0.9 ? 2.7 : 2.4;
    const y = thinking ? 1.15 : 1.0;
    camera.position.set(0, y, z);
    camera.lookAt(0, y, 0);
  }, [camera, size, thinking]);
  return null;
}

/** PAINEL: close-up da cabeça (versão pequena). */
function DashboardCameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const z = aspect < 0.9 ? 1.9 : 1.7;
    camera.position.set(0, 1.05, z);
    camera.lookAt(0, 1.05, 0);
  }, [camera, size]);
  return null;
}

/* ─────────────────── Cena (Canvas) ─────────────────── */

export default function Mascot3D({
  context = 'home',
  isLoggedIn = false,
  speaking = false,
  thinking = false,
  wave = false,
  emotion = 'neutro',
  mood = 'neutral',
}: Mascot3DProps) {
  const isChat = context === 'chat';
  const isDashboard = context === 'dashboard';

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={
        isChat
          ? { position: [0, 1.0, 2.4], fov: 30 }
          : isDashboard
            ? { position: [0, 1.05, 1.7], fov: 30 }
            : { position: [0, 0.55, 4.6], fov: 32 }
      }
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent', touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      {isChat ? (
        <ChatCameraRig thinking={thinking} />
      ) : isDashboard ? (
        <DashboardCameraRig />
      ) : (
        <HomeCameraRig />
      )}

      <MascotStage />

      <Mascot3DCharacter
        context={context}
        isLoggedIn={isLoggedIn}
        speaking={speaking}
        thinking={thinking}
        wave={wave}
        emotion={emotion}
        mood={mood}
      />

      {/* Decoração: só na HOME (chat/painel = busto limpo) */}
      {context === 'home' && (
        <>
          <Podium />
          {isLoggedIn ? (
            <>
              <MiniChart3D />
              <Card3D />
              <Coin3D />
            </>
          ) : (
            <>
              <Phone3D />
              <ShoppingBag3D />
              <Coin3D />
              <Gem3D />
            </>
          )}
        </>
      )}
    </Canvas>
  );
}
