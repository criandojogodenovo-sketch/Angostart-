'use client';

/**
 * AngoStart — Avatar 3D WebGL (Fase 22 · experiência 3D premium).
 *
 * Boneco cartoon LOW-POLY renderizado com @react-three/fiber:
 *  - Visitante  → acena, telemóvel a flutuar + sacola de compras +
 *                 moeda Kz + gema (cena de comércio à volta);
 *  - Autenticado → o MESMO boneco COM óculos 3D, gesto de «empurrar os
 *                 óculos», piscar de olhos + mini gráfico de vendas e
 *                 cartão flutuantes (dados personalizados).
 *
 * Performance (regras do CTO):
 *  - Geometria de baixa poligonagem (cápsulas/esferas 8-28 segmentos);
 *  - SEM shadow maps (sombra falsa = disco translúcido + anel emissivo);
 *  - dpr limitado a 1.5; sem pós-processamento;
 *  - touch-action: pan-y → o canvas NUNCA bloqueia o scroll no telemóvel;
 *  - Carregado via next/dynamic (chunk separado do bundle inicial).
 *
 * Interatividade: o boneco roda suavemente a seguir o ponteiro (lerp).
 */

import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
// Paleta partilhada com a mascote do chat (ChatMascot) — mesmo boneco.
import { SKIN, SKIN_DARK, SHIRT, SHIRT_DARK, HAIR, DARK } from './mascot-palette';

export type Avatar3DProps = {
  /** Autenticado → óculos + gesto de ajuste + elementos «logado». */
  withGlasses?: boolean;
  /** Variante da cena: 'visitante' (comércio) | 'logado' (dados). */
  variant?: 'visitante' | 'logado';
};

/* ─────────────────────── Paleta ─────────────────────── */
/* (constantes exportadas em ./mascot-palette.ts — partilhadas com o ChatMascot) */

/* ─────────────────────── O boneco (meia-corpo, emerge do pódio) ─────────────────────── */

function Character({ withGlasses }: { withGlasses: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const waveArm = useRef<THREE.Group>(null!);
  const glasses = useRef<THREE.Group>(null!);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = group.current;

    // Flutuação suave + rotação a seguir o ponteiro (cena interativa)
    g.position.y = 0.06 + Math.sin(t * 1.3) * 0.045;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, state.pointer.x * 0.5, 0.07);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -state.pointer.y * 0.1, 0.07);

    // Aceno contínuo do braço direito (pivô no ombro)
    waveArm.current.rotation.z = -1.05 + Math.sin(t * 5.4) * 0.4;

    // Piscar de olhos (~a cada 3.6s)
    const phase = t % 3.6;
    eyes.current.scale.y = phase < 0.14 ? 0.12 : 1;

    // Vida: leve baloiço da cabeça
    head.current.rotation.y = Math.sin(t * 0.6) * 0.05;
    head.current.rotation.z = Math.sin(t * 0.8) * 0.03;

    // Autenticado: gesto de «empurrar os óculos» (~a cada 5.2s)
    if (withGlasses) {
      const adj = (t + 1.4) % 5.2;
      const k = adj < 0.7 ? Math.sin((adj / 0.7) * Math.PI) : 0;
      glasses.current.position.y = 0.03 + k * 0.04;
      glasses.current.rotation.x = -0.05 - k * 0.24;
      head.current.rotation.z += k * 0.05;
    }
  });

  return (
    <group ref={group} position={[0, 0.06, 0]}>
      {/* Torso (cápsula) — a base fica afundada no pódio (meia-corpo) */}
      <mesh position={[0, 0.28, 0]}>
        <capsuleGeometry args={[0.32, 0.36, 6, 16]} />
        <meshStandardMaterial color={SHIRT} roughness={0.55} metalness={0.05} />
      </mesh>

      {/* Colarinho branco */}
      <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.12, 0.03, 8, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </mesh>

      {/* Selo AngoStart no peito (círculo emissivo) */}
      <mesh position={[0, 0.3, 0.315]}>
        <circleGeometry args={[0.08, 20]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#60a5fa"
          emissiveIntensity={0.35}
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* Braço esquerdo (junto ao corpo) */}
      <group position={[-0.4, 0.5, 0]}>
        <mesh position={[-0.05, -0.2, 0]} rotation={[0, 0, 0.28]}>
          <capsuleGeometry args={[0.085, 0.3, 4, 8]} />
          <meshStandardMaterial color={SHIRT_DARK} roughness={0.55} />
        </mesh>
        <mesh position={[-0.13, -0.4, 0]}>
          <sphereGeometry args={[0.1, 14, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
      </group>

      {/* Braço direito ACENANDO (pivô no ombro — rotação animada) */}
      <group ref={waveArm} position={[0.4, 0.52, 0]}>
        <mesh position={[0.04, 0.18, 0]} rotation={[0, 0, 0.25]}>
          <capsuleGeometry args={[0.085, 0.3, 4, 8]} />
          <meshStandardMaterial color={SHIRT_DARK} roughness={0.55} />
        </mesh>
        <mesh position={[0.1, 0.4, 0]}>
          <sphereGeometry args={[0.105, 14, 10]} />
          <meshStandardMaterial color={SKIN} roughness={0.6} />
        </mesh>
      </group>

      {/* ── Cabeça (grupo animado) ── */}
      <group ref={head} position={[0, 0.98, 0]}>
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
        {/* Cabelo (calota esférica — termina ACIMA das sobrancelhas) */}
        <mesh position={[0, 0.03, 0]} scale={[1.05, 1.03, 1.05]}>
          <sphereGeometry args={[0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>

        {/* Sobrancelhas */}
        <mesh position={[-0.14, 0.14, 0.38]} rotation={[0, 0, 0.14]}>
          <boxGeometry args={[0.12, 0.03, 0.03]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>
        <mesh position={[0.14, 0.14, 0.38]} rotation={[0, 0, -0.14]}>
          <boxGeometry args={[0.12, 0.03, 0.03]} />
          <meshStandardMaterial color={HAIR} roughness={0.5} />
        </mesh>

        {/* Olhos (grupo animado — piscar) + brilhos */}
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

        {/* Sorriso (arco de torus) */}
        <mesh position={[0, -0.15, 0.37]} rotation={[0.35, 0, Math.PI]}>
          <torusGeometry args={[0.1, 0.021, 6, 12, Math.PI]} />
          <meshStandardMaterial color="#b4562e" roughness={0.6} />
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

        {/* Óculos 3D (apenas autenticado) — aros + lentes + ponte + hastes */}
        {withGlasses && (
          <group ref={glasses} position={[0, 0.03, 0.4]}>
            <mesh position={[-0.15, 0, 0]}>
              <torusGeometry args={[0.095, 0.016, 8, 20]} />
              <meshStandardMaterial color={DARK} metalness={0.55} roughness={0.3} />
            </mesh>
            <mesh position={[0.15, 0, 0]}>
              <torusGeometry args={[0.095, 0.016, 8, 20]} />
              <meshStandardMaterial color={DARK} metalness={0.55} roughness={0.3} />
            </mesh>
            {/* Lentes (discos azulados translúcidos) */}
            <mesh position={[-0.15, 0, 0.008]}>
              <circleGeometry args={[0.082, 20]} />
              <meshStandardMaterial
                color="#38bdf8"
                transparent
                opacity={0.3}
                emissive="#818cf8"
                emissiveIntensity={0.25}
              />
            </mesh>
            <mesh position={[0.15, 0, 0.008]}>
              <circleGeometry args={[0.082, 20]} />
              <meshStandardMaterial
                color="#38bdf8"
                transparent
                opacity={0.3}
                emissive="#818cf8"
                emissiveIntensity={0.25}
              />
            </mesh>
            {/* Ponte */}
            <mesh position={[0, 0.025, 0]}>
              <boxGeometry args={[0.1, 0.02, 0.02]} />
              <meshStandardMaterial color={DARK} metalness={0.55} roughness={0.3} />
            </mesh>
            {/* Hastes até às orelhas */}
            <mesh position={[-0.26, 0.01, -0.07]} rotation={[0, 0.45, 0]}>
              <boxGeometry args={[0.02, 0.02, 0.26]} />
              <meshStandardMaterial color={DARK} metalness={0.55} roughness={0.3} />
            </mesh>
            <mesh position={[0.26, 0.01, -0.07]} rotation={[0, -0.45, 0]}>
              <boxGeometry args={[0.02, 0.02, 0.26]} />
              <meshStandardMaterial color={DARK} metalness={0.55} roughness={0.3} />
            </mesh>
          </group>
        )}
      </group>

      {/* Pódio (disco escuro metálico) + anel emissivo + sombra falsa */}
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
      <mesh position={[0, -0.37, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.8, 28]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

/* ─────────────────── Elementos flutuantes — variante VISITANTE ─────────────────── */

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
          {/* Ecrã emissivo */}
          <mesh position={[0, 0.03, 0.028]}>
            <planeGeometry args={[0.3, 0.52]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#38bdf8"
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
          {/* «App» no ecrã (barra + cartões) */}
          <mesh position={[0, 0.2, 0.031]}>
            <planeGeometry args={[0.22, 0.07]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.7} toneMapped={false} />
          </mesh>
          <mesh position={[-0.06, 0.04, 0.031]}>
            <planeGeometry args={[0.14, 0.1]} />
            <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={0.8} toneMapped={false} />
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
        {/* Asa (arco) */}
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

/* ─────────────────── Elementos flutuantes — variante LOGADO ─────────────────── */

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
        {/* Base do gráfico */}
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
        {/* Cartão branco */}
        <RoundedBox args={[0.38, 0.26, 0.03]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color="#f8fafc" roughness={0.35} />
        </RoundedBox>
        {/* Ícone (quadrado azul) */}
        <RoundedBox args={[0.13, 0.1, 0.02]} radius={0.015} smoothness={2} position={[0, 0.05, 0.02]}>
          <meshStandardMaterial color={SHIRT} roughness={0.4} />
        </RoundedBox>
        {/* «Texto» (linhas cinzentas) */}
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

/* ─────────────────────── Câmara responsiva (nunca sai do ecrã) ─────────────────────── */

/**
 * Ajusta a distância da câmara ao aspeto do canvas: em ecrãs estreitos
 * (mobile, contentor vertical) afasta a câmara para que os elementos
 * flutuantes (±1.15 unidades) e a cabeça (~1.45) caberem SEMPRE no quadro.
 */
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    // Enquadramento: cena completa (sombra -0.36 .. topo do cabelo ~1.56
    // com flutuação) cabe sempre — com margem, sem cortar a cabeça.
    const z = aspect < 1.15 ? 5.4 : aspect < 1.6 ? 4.6 : 4.2;
    camera.position.set(0, 0.55, z);
    camera.lookAt(0, 0.55, 0);
  }, [camera, size]);
  return null;
}

/* ─────────────────────── Cena (Canvas) ─────────────────────── */

export default function Avatar3D({
  withGlasses = false,
  variant = 'visitante',
}: Avatar3DProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.55, 4.6], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent', touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      <CameraRig />
      {/* Iluminação: chave + preenchimento + rim roxo (sem sombras) */}
      <ambientLight intensity={1.0} />
      <directionalLight position={[3, 4, 5]} intensity={2.0} />
      <pointLight position={[-3, 2.5, -2]} intensity={12} color="#7c3aed" />
      <pointLight position={[3.5, -1, 2.5]} intensity={7} color="#38bdf8" />

      <Character withGlasses={withGlasses} />

      {variant === 'visitante' ? (
        <>
          <Phone3D />
          <ShoppingBag3D />
          <Coin3D />
          <Gem3D />
        </>
      ) : (
        <>
          <MiniChart3D />
          <Card3D />
          <Coin3D />
        </>
      )}
    </Canvas>
  );
}
