import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { CelestialBody } from './types';
import {
  createAccretionDiskMaterial,
  createAtmosphereMaterial,
  createBeamMaterial,
  createRingMaterial,
  createRockGeometry,
  createStarMaterial,
  createSurfaceMaterial,
  createTrailMaterial,
  getGlowTexture,
  type SurfaceOptions,
} from '@/stage/materials';
import { useSpacetimeStore } from '@/stores/spacetimeStore';

export const MAX_TRAIL_POINTS = 200;

export interface MeshEntry {
  groupRef:  React.MutableRefObject<THREE.Group | null>;
  meshRef:   React.MutableRefObject<THREE.Mesh | null>;
  glowRef:   React.MutableRefObject<THREE.Mesh | null>;
  trailLine: THREE.Line;
  trailAttr: THREE.BufferAttribute;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-planet looks
// ─────────────────────────────────────────────────────────────────────────────
interface PlanetLook {
  surface: SurfaceOptions;
  atmosphere?: { color: string; strength: number };
  clouds?: boolean;
  tilt: number;
  spin: number;
}

const PLANET_LOOKS: Record<string, PlanetLook> = {
  Mercury: { surface: { kind: 'rocky', colors: ['#5e5a55', '#9c978f', '#c7c2b9'], frequency: 2.6, craters: 1, seed: 3.1 }, tilt: 0.02, spin: 0.12 },
  Venus:   { surface: { kind: 'ice', colors: ['#c99a5b', '#f0d6a2', '#e3bb7c'], frequency: 7, seed: 5.4, roughness: 0.85 }, atmosphere: { color: '#ffd59a', strength: 1.1 }, tilt: 3.09, spin: 0.08 },
  Earth:   { surface: { kind: 'earth', colors: ['#000000', '#000000', '#000000'], caps: 0.8, seed: 1.3 }, atmosphere: { color: '#5fb0ff', strength: 1.5 }, clouds: true, tilt: 0.41, spin: 0.3 },
  Mars:    { surface: { kind: 'rocky', colors: ['#7a3318', '#c4643a', '#e3a06c'], frequency: 2.0, craters: 0.45, caps: 0.86, seed: 8.2 }, atmosphere: { color: '#ff9a6a', strength: 0.55 }, tilt: 0.44, spin: 0.28 },
  Jupiter: { surface: { kind: 'gas', colors: ['#b98358', '#efe2c4', '#8f5532'], frequency: 24, seed: 2.2, spot: [0.92, -0.34, 0.2, 0.2], spotColor: '#b4513a' }, atmosphere: { color: '#f3d6a8', strength: 0.6 }, tilt: 0.05, spin: 0.55 },
  Saturn:  { surface: { kind: 'gas', colors: ['#cfb27a', '#f2e4bc', '#ad8f58'], frequency: 28, seed: 6.6 }, atmosphere: { color: '#f2dfae', strength: 0.5 }, tilt: 0.47, spin: 0.5 },
  Uranus:  { surface: { kind: 'ice', colors: ['#86d0d8', '#b4eef0', '#76c0cc'], frequency: 9, seed: 4.4 }, atmosphere: { color: '#a8f2f6', strength: 1.0 }, tilt: 1.71, spin: 0.4 },
  Neptune: { surface: { kind: 'ice', colors: ['#3756c9', '#6a8cf2', '#25409f'], frequency: 12, seed: 9.9, spot: [0.7, -0.3, 0.6, 0.16], spotColor: '#1a2a6a' }, atmosphere: { color: '#6f9bff', strength: 1.1 }, tilt: 0.49, spin: 0.42 },
};

const shade = (hex: string, lightness: number) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, lightness);
  return `#${c.getHexString()}`;
};

const lookForBody = (body: CelestialBody): PlanetLook => {
  const named = body.name ? PLANET_LOOKS[body.name] : undefined;
  if (named) return named;
  const seed = (body.id.length * 1.37) % 10;
  if (body.bodyClass === 'gas') {
    return { surface: { kind: 'gas', colors: [shade(body.color, -0.2), shade(body.color, 0.2), shade(body.color, -0.36)], frequency: 20, seed }, atmosphere: { color: shade(body.color, 0.2), strength: 0.6 }, tilt: 0.2, spin: 0.5 };
  }
  if (body.bodyClass === 'ice') {
    return { surface: { kind: 'ice', colors: [shade(body.color, -0.08), shade(body.color, 0.1), shade(body.color, -0.18)], frequency: 10, seed }, atmosphere: { color: shade(body.color, 0.2), strength: 1 }, tilt: 0.3, spin: 0.4 };
  }
  return {
    surface: { kind: 'rocky', colors: [shade(body.color, -0.22), body.color, shade(body.color, 0.15)], frequency: 2.4, craters: 0.6, seed },
    atmosphere: body.atmosphere ? { color: shade(body.color, 0.25), strength: 0.8 } : undefined,
    tilt: 0.3,
    spin: 0.25,
  };
};

const ASTEROID_SURFACE: SurfaceOptions = { kind: 'rocky', colors: ['#4d4842', '#878075', '#a9a092'], frequency: 2.8, craters: 0.9, seed: 11 };
const COMET_SURFACE: SurfaceOptions = { kind: 'rocky', colors: ['#252b33', '#4b5562', '#a8c6d8'], frequency: 3.2, craters: 0.5, seed: 17, nightGlow: 0.08 };

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ─────────────────────────────────────────────────────────────────────────────
// BodyRenderer — visual-only, writes nothing to physics state.
// Physics drives: groupRef.position, meshRef.scale, glowRef.scale/opacity.
// ─────────────────────────────────────────────────────────────────────────────
interface BodyRendererProps {
  body:           CelestialBody;
  meshEntriesRef: React.MutableRefObject<Map<string, MeshEntry>>;
}

export const BodyRenderer: React.FC<BodyRendererProps> = ({ body, meshEntriesRef }) => {
  const groupRef   = useRef<THREE.Group | null>(null);
  const meshRef    = useRef<THREE.Mesh  | null>(null);
  const glowRef    = useRef<THREE.Mesh  | null>(null);   // motion-state proxy, never visible
  const haloRef    = useRef<THREE.Sprite | null>(null);
  const diskRef    = useRef<THREE.Group | null>(null);
  const photonRef  = useRef<THREE.Mesh  | null>(null);
  const beamRef    = useRef<THREE.Group | null>(null);
  const tailRef    = useRef<THREE.Group | null>(null);
  const cloudRef   = useRef<THREE.Mesh  | null>(null);
  const animT      = useRef(Math.random() * Math.PI * 2);
  const prevPos    = useRef<THREE.Vector3 | null>(null);
  const tailDir    = useRef(new THREE.Vector3(1, 0, 0));

  const isStar    = body.type === 'star';
  const isBH      = body.type === 'blackhole';
  const isNS      = body.type === 'neutron';
  const isComet   = body.type === 'comet';
  const isAst     = body.type === 'asteroid';
  const isPlanet  = body.type === 'planet';
  const isSaturn  = body.name === 'Saturn';
  const isUranus  = body.name === 'Uranus';
  const selected  = useSpacetimeStore((state) => state.selectedBodyId === body.id);
  const gl        = useThree((state) => state.gl);

  // Selection uses a dedicated hit sphere: halos and tails are far larger than the body.
  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    const store = useSpacetimeStore.getState();
    if (store.pendingPlacement) return;
    event.stopPropagation();
    store.selectBody(body.id);
  };

  const { trailLine, trailAttr, trailMaterial } = useMemo(() => {
    const geo  = new THREE.BufferGeometry();
    const data = new Float32Array(MAX_TRAIL_POINTS * 3);
    const attr = new THREE.BufferAttribute(data, 3);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const mat = createTrailMaterial(isBH ? '#cc66ff' : body.color, isStar ? 0.35 : 0.6);
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { trailLine: line, trailAttr: attr, trailMaterial: mat };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = meshEntriesRef.current;
    map.set(body.id, { groupRef, meshRef, glowRef, trailLine, trailAttr });
    return () => { map.delete(body.id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  useEffect(() => () => {
    trailLine.geometry.dispose();
    trailMaterial.dispose();
  }, [trailLine, trailMaterial]);

  const look = useMemo(() => (isPlanet ? lookForBody(body) : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [isPlanet, body.name, body.bodyClass, body.color]);

  const surfaceMaterial = useMemo(() => {
    if (look) return createSurfaceMaterial(look.surface, gl);
    if (isAst) return createSurfaceMaterial(ASTEROID_SURFACE, gl, 128);
    if (isComet) return createSurfaceMaterial(COMET_SURFACE, gl, 128);
    if (!isStar && !isBH && !isNS) {
      return createSurfaceMaterial({ kind: 'rocky', colors: [shade(body.color, -0.2), body.color, shade(body.color, 0.15)], frequency: 2.4, craters: 0.4 }, gl);
    }
    return null;
  }, [look, isAst, isComet, isStar, isBH, isNS, body.color, gl]);

  const cloudMaterial = useMemo(
    () => (look?.clouds ? createSurfaceMaterial({ kind: 'clouds', colors: ['#fff', '#fff', '#fff'], seed: 2.7, roughness: 1, nightGlow: 0.02 }, gl) : null),
    [look, gl],
  );
  const atmosphereMaterial = useMemo(
    () => (look?.atmosphere ? createAtmosphereMaterial(look.atmosphere.color, look.atmosphere.strength, 3.2) : null),
    [look],
  );
  const starMaterial = useMemo(
    () => (isStar ? createStarMaterial(body.color, 1.35, gl) : isNS ? createStarMaterial('#9ef4ff', 3.2, gl) : null),
    [isStar, isNS, body.color, gl],
  );
  const coronaMaterial = useMemo(
    () => (isStar ? createAtmosphereMaterial(body.color, 0.9, 2.6) : isNS ? createAtmosphereMaterial('#7ff7ff', 1.6, 2.0) : null),
    [isStar, isNS, body.color],
  );
  const diskMaterial = useMemo(() => (isBH ? createAccretionDiskMaterial(1.25, 4.6) : null), [isBH]);
  const beamMaterial = useMemo(() => (isNS ? createBeamMaterial('#7ff7ff', 2.2, 1) : null), [isNS]);
  const tailMaterials = useMemo(
    () => (isComet ? { dust: createBeamMaterial('#f2deaa', 0.9), ion: createBeamMaterial('#79c8ff', 1.5, 1) } : null),
    [isComet],
  );
  const ringMaterial = useMemo(() => {
    if (isSaturn) return createRingMaterial(1.28, 2.55, '#e8d9a8', 0.9, 3.3);
    if (isUranus) return createRingMaterial(1.55, 1.85, '#bfe9f0', 0.35, 7.1);
    return null;
  }, [isSaturn, isUranus]);
  const rockGeometry = useMemo(
    () => (isAst || isComet ? createRockGeometry(body.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) / 97, isComet ? 0.22 : 0.34) : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [isAst, isComet]);

  useEffect(() => () => {
    starMaterial?.dispose();
    coronaMaterial?.dispose();
    atmosphereMaterial?.dispose();
    diskMaterial?.dispose();
    beamMaterial?.dispose();
    tailMaterials?.dust.dispose();
    tailMaterials?.ion.dispose();
    ringMaterial?.dispose();
  }, [starMaterial, coronaMaterial, atmosphereMaterial, diskMaterial, beamMaterial, tailMaterials, ringMaterial]);

  const haloColor = useMemo(() => {
    const base = isBH ? '#b86bff' : isNS ? '#7ff7ff' : isComet ? '#aee8ff' : body.color;
    return new THREE.Color(base);
  }, [isBH, isNS, isComet, body.color]);

  const haloBase = isStar ? 0.45 : isNS ? 0.7 : isBH ? 0.18 : isComet ? 0.45 : 0.12;
  const haloScale = isStar ? 9 : isNS ? 9 : isBH ? 7 : isComet ? 8 : 3.2;

  useFrame((state, delta) => {
    animT.current += delta;
    const t = animT.current;

    // Surface rotation
    if (meshRef.current) {
      let spd = look?.spin ?? 0.25;
      if (isBH) spd = 0;
      else if (isNS) spd = 2.0;
      else if (isStar) spd = 0.06;
      else if (isComet) spd = 0.12;
      else if (isAst) spd = 0.35;
      meshRef.current.rotation.y += delta * spd;
      if (isAst) meshRef.current.rotation.x += delta * 0.18;
    }
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.02;

    // Animated shader time
    if (starMaterial) starMaterial.uniforms.uTime.value = t;
    if (diskMaterial) diskMaterial.uniforms.uTime.value = t;
    if (beamMaterial) beamMaterial.uniforms.uTime.value = t;
    if (tailMaterials) tailMaterials.ion.uniforms.uTime.value = t;
    if (cloudMaterial) cloudMaterial.userData.uniforms.uTime.value = t;

    // Trail fade needs the live point count
    trailMaterial.uniforms.uCount.value = trailLine.geometry.drawRange.count;

    // Halo reflects the physics motion state written to the glow proxy
    if (haloRef.current) {
      const proxy = glowRef.current?.material as THREE.MeshBasicMaterial | undefined;
      const escaping = (proxy?.opacity ?? 0.08) > 0.12;
      const mat = haloRef.current.material;
      const pulse = isStar ? 1 + Math.sin(t * 1.3) * 0.04 : 1;
      mat.opacity = THREE.MathUtils.damp(mat.opacity, escaping ? Math.min(1, haloBase * 2.4 + 0.15) : haloBase, 4, delta);
      const r = meshRef.current?.scale.x ?? body.radius;
      haloRef.current.scale.setScalar(r * haloScale * pulse);
    }

    // Black hole photon ring always faces the camera
    if (photonRef.current) photonRef.current.quaternion.copy(state.camera.quaternion);
    if (diskRef.current) diskRef.current.rotation.z += delta * 0.05;

    // Neutron star beams sweep around a tilted magnetic axis
    if (beamRef.current) beamRef.current.rotation.y += delta * 4.2;

    // Comet tails trail away from the direction of travel
    if (tailRef.current && groupRef.current) {
      const pos = groupRef.current.position;
      if (prevPos.current) {
        const v = pos.clone().sub(prevPos.current);
        if (v.lengthSq() > 1e-8) {
          tailDir.current.lerp(v.normalize().negate(), Math.min(1, delta * 4)).normalize();
        }
      } else {
        prevPos.current = new THREE.Vector3();
      }
      prevPos.current.copy(pos);
      tailRef.current.quaternion.setFromUnitVectors(Y_AXIS, tailDir.current);
    }
  });

  const r = body.radius;

  return (
    <>
      <primitive object={trailLine} />
      <group ref={groupRef} position={body.position}>

        <mesh
          visible={false}
          scale={Math.max(r * 1.4, 0.6)}
          onClick={handleSelect}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial />
        </mesh>

        {selected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -r * 0.8, 0]} scale={r}>
            <ringGeometry args={[1.55, 1.66, 96]} />
            <meshBasicMaterial color="#3fd8f5" transparent opacity={0.85} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Invisible proxy: physics writes motion state into its opacity */}
        <mesh ref={glowRef} visible={false}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial transparent opacity={0.08} />
        </mesh>

        {/* Soft halo */}
        <sprite ref={haloRef} scale={r * haloScale}>
          <spriteMaterial
            map={getGlowTexture()}
            color={haloColor}
            transparent
            opacity={haloBase}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>

        {/* ── STAR ─────────────────────────────────────────────────────────── */}
        {isStar && starMaterial && <>
          <mesh ref={meshRef} scale={r} material={starMaterial}>
            <sphereGeometry args={[1, 64, 64]} />
          </mesh>
          {coronaMaterial && (
            <mesh scale={r * 1.18} material={coronaMaterial}>
              <sphereGeometry args={[1, 32, 32]} />
            </mesh>
          )}
          <pointLight color={shade(body.color, 0.18)} intensity={2.6} decay={0} distance={0} />
        </>}

        {/* ── BLACK HOLE ───────────────────────────────────────────────────── */}
        {isBH && diskMaterial && <>
          <mesh ref={meshRef} scale={r}>
            <sphereGeometry args={[1, 48, 48]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
          <mesh ref={photonRef}>
            <ringGeometry args={[r * 1.03, r * 1.16, 128]} />
            <meshBasicMaterial color={new THREE.Color('#ffd9a8').multiplyScalar(1.6)} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <group rotation={[Math.PI / 2 - 0.3, 0, 0]}>
            <group ref={diskRef} scale={r}>
              <mesh material={diskMaterial}>
                <ringGeometry args={[1.25, 4.6, 256, 1]} />
              </mesh>
            </group>
          </group>
        </>}

        {/* ── NEUTRON STAR ─────────────────────────────────────────────────── */}
        {isNS && starMaterial && beamMaterial && <>
          <mesh ref={meshRef} scale={r} material={starMaterial}>
            <sphereGeometry args={[1, 48, 48]} />
          </mesh>
          {coronaMaterial && (
            <mesh scale={r * 1.35} material={coronaMaterial}>
              <sphereGeometry args={[1, 32, 32]} />
            </mesh>
          )}
          <group rotation={[0, 0, 0.38]}>
            <group ref={beamRef}>
              <mesh material={beamMaterial} position={[0, r * 4.6, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[r * 0.9, r * 9, 32, 1, true]} />
              </mesh>
              <mesh material={beamMaterial} position={[0, -r * 4.6, 0]}>
                <coneGeometry args={[r * 0.9, r * 9, 32, 1, true]} />
              </mesh>
            </group>
          </group>
        </>}

        {/* ── PLANETS ──────────────────────────────────────────────────────── */}
        {isPlanet && surfaceMaterial && look && <>
          <group rotation={[0, 0, look.tilt]}>
            <mesh ref={meshRef} scale={r} material={surfaceMaterial}>
              <sphereGeometry args={[1, 64, 64]} />
              {cloudMaterial && (
                <mesh ref={cloudRef} scale={1.015} material={cloudMaterial}>
                  <sphereGeometry args={[1, 48, 48]} />
                </mesh>
              )}
              {atmosphereMaterial && (
                <mesh scale={1.07} material={atmosphereMaterial}>
                  <sphereGeometry args={[1, 48, 48]} />
                </mesh>
              )}
            </mesh>
          </group>
          {ringMaterial && (
            <group rotation={isUranus ? [0, 0, Math.PI / 2 - 0.06] : [Math.PI / 2 - 0.47, 0, 0.18]}>
              <mesh scale={r} material={ringMaterial}>
                <ringGeometry args={isUranus ? [1.55, 1.85, 160, 1] : [1.28, 2.55, 192, 1]} />
              </mesh>
            </group>
          )}
        </>}

        {/* ── ASTEROID ─────────────────────────────────────────────────────── */}
        {isAst && surfaceMaterial && rockGeometry && (
          <mesh ref={meshRef} scale={r} geometry={rockGeometry} material={surfaceMaterial} />
        )}

        {/* ── COMET ────────────────────────────────────────────────────────── */}
        {isComet && surfaceMaterial && rockGeometry && tailMaterials && <>
          <mesh ref={meshRef} scale={r} geometry={rockGeometry} material={surfaceMaterial} />
          <group ref={tailRef}>
            {/* Dust tail: broad, warm */}
            <mesh material={tailMaterials.dust} position={[0, r * 8, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[r * 3.2, r * 16, 24, 1, true]} />
            </mesh>
            {/* Ion tail: narrow, blue, longer */}
            <mesh material={tailMaterials.ion} position={[0, r * 11, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[r * 1.1, r * 22, 16, 1, true]} />
            </mesh>
          </group>
        </>}

        {/* ── Fallback for unknown types ───────────────────────────────────── */}
        {!isStar && !isBH && !isNS && !isComet && !isAst && !isPlanet && surfaceMaterial && (
          <mesh ref={meshRef} scale={r} material={surfaceMaterial}>
            <sphereGeometry args={[1, 48, 48]} />
          </mesh>
        )}

      </group>
    </>
  );
};
