import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createBeamMaterial } from '@/stage/materials';
import { gsap, motionDuration } from '@/motion/gsap';

// ─────────────────────────────────────────────────────────────────────────────
// Rocket body textures
// ─────────────────────────────────────────────────────────────────────────────
const makeStageTexture = (variant: 'lower' | 'upper') => {
  const W = 512;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#eceff3';
  ctx.fillRect(0, 0, W, H);

  // Panel seams and rivet rows
  ctx.strokeStyle = 'rgba(40,50,64,0.14)';
  ctx.lineWidth = 2;
  for (let y = 64; y < H; y += 96) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let x = 0; x < W; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(40,50,64,0.16)';
  for (let y = 70; y < H; y += 96) {
    for (let x = 6; x < W; x += 16) ctx.fillRect(x, y, 2, 2);
  }

  if (variant === 'lower') {
    // Graphite band at the top (under the interstage) and a thin signal-cyan pinstripe
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(0, 0, W, H * 0.06);
    ctx.fillStyle = '#3fd8f5';
    ctx.fillRect(0, H * 0.075, W, 4);
    // Vehicle designation, small and vertical like real launcher markings
    ctx.save();
    ctx.translate(W * 0.25, H * 0.42);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#1b2029';
    ctx.font = '500 34px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CP-1', 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(0, H * 0.94, W, H * 0.06);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const makeStrakeGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.11, -0.03);
  shape.lineTo(0.12, 0.05);
  shape.lineTo(0.0, 0.26);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
  geo.translate(0, 0, -0.007);
  return geo;
};

const makeNoseGeometry = () => {
  // Tangent ogive fairing from base radius R to the tip
  const pts: THREE.Vector2[] = [];
  const R = 0.15;
  const L = 0.62;
  const rho = (R * R + L * L) / (2 * R);
  for (let i = 0; i <= 28; i++) {
    const x = (i / 28) * L;
    const y = Math.sqrt(rho * rho - (L - x) * (L - x)) + R - rho;
    pts.push(new THREE.Vector2(Math.max(y, 0.0005), x));
  }
  return new THREE.LatheGeometry(pts, 48);
};

const makeBellGeometry = () => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(0.05 + Math.pow(t, 1.6) * 0.075, -t * 0.22));
  }
  return new THREE.LatheGeometry(pts, 40);
};

const ENGINE_OFFSETS: [number, number][] = [[0.07, 0], [-0.035, 0.0606], [-0.035, -0.0606]];

// ─────────────────────────────────────────────────────────────────────────────
// Launch vehicle (visual only — parent group is driven by RocketModel)
// Two stages: the first can detach and fall away at burnout.
// ─────────────────────────────────────────────────────────────────────────────
export const RocketVehicle = ({
  thrusting,
  intensity,
  stageSeparation,
  separated,
}: {
  thrusting: boolean;
  intensity: number;
  stageSeparation: boolean;
  /** First stage has detached (burnout with separation enabled). */
  separated: boolean;
}) => {
  const resources = useMemo(() => ({
    lowerTex: makeStageTexture('lower'),
    upperTex: makeStageTexture('upper'),
    strake: makeStrakeGeometry(),
    nose: makeNoseGeometry(),
    bell: makeBellGeometry(),
    plumeOuter: createBeamMaterial('#ff8a3a', 2.8, 1),
    plumeCore: createBeamMaterial('#bfe6ff', 3.2, 1),
  }), []);

  useEffect(() => () => {
    resources.lowerTex.dispose();
    resources.upperTex.dispose();
    resources.strake.dispose();
    resources.nose.dispose();
    resources.bell.dispose();
    resources.plumeOuter.dispose();
    resources.plumeCore.dispose();
  }, [resources]);

  const plumeRef = useRef<THREE.Group>(null);
  const throatRef = useRef<THREE.MeshBasicMaterial>(null);
  const firstStageRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);

  // Separation: the spent stage drops away and tumbles in the vehicle's frame,
  // with a brief ring flash at the joint. Reversible so rewind re-attaches it.
  useEffect(() => {
    const stage = firstStageRef.current;
    if (!stage) return undefined;
    const tweens: gsap.core.Tween[] = [];
    if (separated) {
      tweens.push(gsap.to(stage.position, { y: -2.6, x: 0.35, duration: motionDuration(2.4), ease: 'fall' }));
      tweens.push(gsap.to(stage.rotation, { z: 0.9, x: 0.4, duration: motionDuration(2.4), ease: 'power1.in' }));
      tweens.push(gsap.to(stage, { duration: motionDuration(2.4), onComplete: () => { stage.visible = false; } }));
      if (flashRef.current) {
        const mat = flashRef.current.material as THREE.MeshBasicMaterial;
        tweens.push(gsap.fromTo(mat, { opacity: 0.9 }, { opacity: 0, duration: motionDuration(0.6), ease: 'power2.out' }));
        tweens.push(gsap.fromTo(flashRef.current.scale, { x: 1, y: 1, z: 1 }, { x: 2.4, y: 2.4, z: 2.4, duration: motionDuration(0.6), ease: 'power2.out' }));
      }
    } else {
      stage.visible = true;
      stage.position.set(0, 0, 0);
      stage.rotation.set(0, 0, 0);
    }
    return () => tweens.forEach((tween) => tween.kill());
  }, [separated]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    resources.plumeOuter.uniforms.uTime.value = t;
    resources.plumeCore.uniforms.uTime.value = t;
    if (plumeRef.current) {
      const flicker = 1 + Math.sin(t * 38) * 0.05 + Math.sin(t * 23) * 0.04;
      const len = THREE.MathUtils.clamp(0.6 + intensity * 0.35, 0.6, 2.2);
      plumeRef.current.scale.set(flicker, len * flicker, flicker);
    }
    if (throatRef.current) throatRef.current.opacity = thrusting ? 0.9 + Math.sin(t * 40) * 0.1 : 0;
  });

  return (
    <group>
      {/* ── First stage ─────────────────────────────────────────────────── */}
      <group ref={firstStageRef}>
        {/* Engine section: skirt and a cluster of three bells */}
        <mesh position={[0, -0.03, 0]}>
          <cylinderGeometry args={[0.158, 0.17, 0.08, 48]} />
          <meshStandardMaterial color="#232832" metalness={0.7} roughness={0.42} />
        </mesh>
        {ENGINE_OFFSETS.map(([x, z]) => (
          <mesh key={`${x}-${z}`} geometry={resources.bell} position={[x, -0.07, z]} scale={0.62}>
            <meshStandardMaterial color="#4a3a30" metalness={0.92} roughness={0.32} side={THREE.DoubleSide} />
          </mesh>
        ))}
        <mesh position={[0, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.13, 24]} />
          <meshBasicMaterial ref={throatRef} color={new THREE.Color('#ffd28a').multiplyScalar(3)} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>

        {/* Tank section */}
        <mesh position={[0, 0.475, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.95, 48]} />
          <meshPhysicalMaterial map={resources.lowerTex} metalness={0.15} roughness={0.4} clearcoat={0.4} clearcoatRoughness={0.35} />
        </mesh>

        {/* Graphite strakes for stability */}
        {[Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].map((rot) => (
          <group key={rot} rotation={[0, rot, 0]}>
            <mesh geometry={resources.strake} position={[0.155, 0.02, 0]}>
              <meshStandardMaterial color="#2a303a" metalness={0.5} roughness={0.45} />
            </mesh>
          </group>
        ))}

        {/* Interstage */}
        <mesh position={[0, 1.01, 0]}>
          <cylinderGeometry args={[0.15, 0.16, 0.12, 48]} />
          <meshStandardMaterial color="#161a21" metalness={0.45} roughness={0.55} />
        </mesh>

        {/* Plume: apex at the nozzles, opening downward */}
        <group ref={plumeRef} position={[0, -0.24, 0]} visible={thrusting}>
          <mesh material={resources.plumeOuter} position={[0, -0.8, 0]}>
            <coneGeometry args={[0.24, 1.6, 32, 1, true]} />
          </mesh>
          <mesh material={resources.plumeCore} position={[0, -0.35, 0]}>
            <coneGeometry args={[0.1, 0.7, 24, 1, true]} />
          </mesh>
        </group>
      </group>

      {/* ── Upper stage ─────────────────────────────────────────────────── */}
      {/* Vacuum engine bell, hidden inside the interstage until separation */}
      <mesh geometry={resources.bell} position={[0, 1.07, 0]} scale={[0.95, 0.6, 0.95]}>
        <meshStandardMaterial color="#5a4a3e" metalness={0.92} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.345, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.55, 48]} />
        <meshPhysicalMaterial map={resources.upperTex} metalness={0.15} roughness={0.38} clearcoat={0.45} clearcoatRoughness={0.3} />
      </mesh>
      {/* Fairing base ring: the one accent colour on the vehicle */}
      <mesh position={[0, 1.622, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.151, 0.006, 8, 48]} />
        <meshStandardMaterial color="#3fd8f5" emissive="#3fd8f5" emissiveIntensity={0.6} metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh geometry={resources.nose} position={[0, 1.625, 0]}>
        <meshPhysicalMaterial color="#f1f3f6" metalness={0.15} roughness={0.32} clearcoat={0.8} clearcoatRoughness={0.2} />
      </mesh>

      {/* Separation joint: armed marker before launch, flash at separation */}
      {stageSeparation && !separated && (
        <mesh position={[0, 1.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.162, 0.005, 8, 48]} />
          <meshBasicMaterial color="#f5b83d" toneMapped={false} />
        </mesh>
      )}
      <mesh ref={flashRef} position={[0, 1.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.2, 48]} />
        <meshBasicMaterial color={new THREE.Color('#ffe2b0').multiplyScalar(2)} transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Launch complex
// ─────────────────────────────────────────────────────────────────────────────
const makeConcreteTexture = () => {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7d848d';
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // slab joints
  ctx.strokeStyle = 'rgba(30,34,40,0.55)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= S; x += S / 4) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(S, x); ctx.stroke();
  }
  // scorch marks
  for (let i = 0; i < 6; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.3;
    const y = S / 2 + (Math.random() - 0.5) * S * 0.3;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 60 + Math.random() * 60);
    g.addColorStop(0, 'rgba(20,18,16,0.45)');
    g.addColorStop(1, 'rgba(20,18,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const makeGroundTexture = () => {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#272c35';
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 1.1;
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 40);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const LatticeTower = ({ height = 9, width = 0.8, position }: { height?: number; width?: number; position: [number, number, number] }) => {
  const struts = useMemo(() => {
    const items: { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = [];
    const half = width / 2;
    const corners: [number, number][] = [[-half, -half], [half, -half], [half, half], [-half, half]];
    const add = (a: THREE.Vector3, b: THREE.Vector3) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      items.push({ pos: a.clone().add(b).multiplyScalar(0.5), quat, len });
    };
    corners.forEach(([x, z]) => add(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z)));
    const step = 0.75;
    for (let y = 0; y < height; y += step) {
      for (let c = 0; c < 4; c++) {
        const [x1, z1] = corners[c];
        const [x2, z2] = corners[(c + 1) % 4];
        add(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2));
        add(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, Math.min(y + step, height), z2));
      }
    }
    return items;
  }, [height, width]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    struts.forEach((s, i) => {
      m.compose(s.pos, s.quat, new THREE.Vector3(1, s.len, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [struts]);

  return (
    <group position={position}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, struts.length]}>
        <boxGeometry args={[0.045, 1, 0.045]} />
        <meshStandardMaterial color="#9aa3ae" metalness={0.75} roughness={0.38} />
      </instancedMesh>
      {/* Service platforms */}
      {[2.4, 4.8, 7.2].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[width + 0.25, 0.05, width + 0.25]} />
          <meshStandardMaterial color="#5f6772" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
};

export const LaunchComplex = () => {
  const textures = useMemo(() => ({ concrete: makeConcreteTexture(), ground: makeGroundTexture() }), []);
  useEffect(() => () => {
    textures.concrete.dispose();
    textures.ground.dispose();
  }, [textures]);

  const beaconRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    if (beaconRef.current) {
      const on = Math.sin(state.clock.elapsedTime * 3.2) > 0.2;
      beaconRef.current.color.set(on ? '#ff3b3b' : '#4a0d0d').multiplyScalar(on ? 3 : 1);
    }
  });

  return (
    <group>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[160, 64]} />
        <meshStandardMaterial map={textures.ground} color="#9aa4b5" roughness={0.95} metalness={0.02} />
      </mesh>
      {/* Faint survey grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[200, 200, 50, 50]} />
        <meshBasicMaterial color="#3d5470" wireframe transparent opacity={0.18} />
      </mesh>

      {/* Pad: octagonal concrete plinth */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[4.3, 4.6, 0.12, 8]} />
        <meshStandardMaterial map={textures.concrete} roughness={0.9} metalness={0.05} />
      </mesh>
      {/* Flame deflector trench */}
      <mesh position={[0, 0.125, 1.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.0, 2.6]} />
        <meshStandardMaterial color="#121418" roughness={1} />
      </mesh>
      {/* Hazard ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.13, 0]}>
        <ringGeometry args={[2.9, 3.15, 64]} />
        <meshBasicMaterial color={new THREE.Color('#f59e0b').multiplyScalar(1.2)} toneMapped={false} />
      </mesh>
      {/* Launch mount glow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.13, 0]}>
        <ringGeometry args={[0.85, 1.05, 64]} />
        <meshBasicMaterial color={new THREE.Color('#38bdf8').multiplyScalar(1.8)} toneMapped={false} />
      </mesh>
      {/* Hold-down clamps */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot) => (
        <mesh key={rot} position={[Math.sin(rot + Math.PI / 4) * 0.55, 0.25, Math.cos(rot + Math.PI / 4) * 0.55]}>
          <boxGeometry args={[0.14, 0.28, 0.14]} />
          <meshStandardMaterial color="#3a414c" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}

      {/* Tower + umbilical arm */}
      <LatticeTower position={[-2.6, 0.12, 0]} />
      <mesh position={[-1.45, 3.75, 0]}>
        <boxGeometry args={[2.3, 0.12, 0.18]} />
        <meshStandardMaterial color="#aab2bd" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[-1.45, 3.67, 0]}>
        <boxGeometry args={[2.3, 0.04, 0.05]} />
        <meshStandardMaterial color="#e5484d" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* Beacon */}
      <mesh position={[-2.6, 9.25, 0]}>
        <sphereGeometry args={[0.13, 12, 12]} />
        <meshBasicMaterial ref={beaconRef} color="#ff3b3b" toneMapped={false} />
      </mesh>
      <pointLight position={[-2.6, 9.3, 0]} color="#ef4444" intensity={2} distance={10} />

      {/* Flood light masts */}
      {[[4.2, 4.2], [-4.4, -3.6]].map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 2, 0]}>
            <cylinderGeometry args={[0.04, 0.06, 4, 8]} />
            <meshStandardMaterial color="#6b7380" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[0, 4.05, 0]}>
            <boxGeometry args={[0.45, 0.22, 0.12]} />
            <meshBasicMaterial color={new THREE.Color('#fff4d6').multiplyScalar(2)} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 3.6, 0]} color="#fff1d0" intensity={4} distance={15} />
        </group>
      ))}
    </group>
  );
};
