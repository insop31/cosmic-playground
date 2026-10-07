import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Shared GLSL: 3D simplex noise (Stefan Gustavson / Ashima Arts, MIT) + fbm
// ─────────────────────────────────────────────────────────────────────────────
export const NOISE_GLSL = /* glsl */ `
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _permute(vec4 x) { return _mod289(((x * 34.0) + 10.0) * x); }
vec4 _taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = _mod289(i);
  vec4 p = _permute(_permute(_permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(1.7, -2.3, 0.9);
    amp *= 0.5;
  }
  return sum;
}

float fbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * snoise(p);
    p = p * 2.07 + vec3(-1.3, 0.7, 2.1);
    amp *= 0.5;
  }
  return sum;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Procedural planet surface — MeshStandardMaterial so it keeps PBR lighting
// ─────────────────────────────────────────────────────────────────────────────
export type SurfaceKind = 'rocky' | 'earth' | 'gas' | 'ice' | 'clouds';

const KIND_INDEX: Record<SurfaceKind, number> = { rocky: 0, earth: 1, gas: 2, ice: 3, clouds: 4 };

export interface SurfaceOptions {
  kind: SurfaceKind;
  colors: [string, string, string];
  seed?: number;
  /** Feature frequency (bands for gas giants, terrain scale otherwise). */
  frequency?: number;
  /** |y| above which polar ice appears (0 disables). */
  caps?: number;
  /** Crater strength for rocky bodies (0–1). */
  craters?: number;
  /** Storm spot: direction xyz + angular radius, and its colour. */
  spot?: [number, number, number, number];
  spotColor?: string;
  /** Self-illumination so the night side never goes fully black. */
  nightGlow?: number;
  roughness?: number;
}

const SURFACE_FRAGMENT = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  vec3 sp = p + uSeed;
  gOcean = 0.0;
  if (uKind == 1) {
    // Earth-like: oceans, continents, deserts, ice caps
    float h = fbm(sp * 1.35) + 0.22 * fbm(sp * 5.0);
    float lat = abs(p.y);
    vec3 deep = vec3(0.02, 0.10, 0.28);
    vec3 shallow = vec3(0.05, 0.32, 0.55);
    vec3 col;
    if (h < 0.04) {
      col = mix(deep, shallow, smoothstep(-0.35, 0.04, h));
      gOcean = 1.0;
    } else {
      float dry = smoothstep(0.15, 0.45, fbm(sp * 3.1 + 7.0) + (0.35 - abs(lat - 0.32)) * 0.9);
      vec3 green = mix(vec3(0.10, 0.30, 0.10), vec3(0.22, 0.38, 0.14), fbm(sp * 9.0) * 0.5 + 0.5);
      vec3 desert = vec3(0.62, 0.50, 0.32);
      col = mix(green, desert, dry);
      col = mix(col, vec3(0.42, 0.38, 0.34), smoothstep(0.32, 0.55, h)); // highlands
    }
    float cap = smoothstep(uCaps - 0.04, uCaps + 0.02, lat + fbm(sp * 4.0) * 0.06);
    col = mix(col, vec3(0.92, 0.95, 0.98), cap);
    gOcean *= 1.0 - cap;
    return col;
  }
  if (uKind == 2 || uKind == 3) {
    // Gas / ice giants: turbulent latitude bands
    // Turbulence is in latitude units, so keep it small relative to the band period
    float turb = (uKind == 2 ? 2.2 : 1.1) / uFreq;
    float warp = fbm(vec3(sp.x * 2.2, sp.y * 9.0, sp.z * 2.2)) * turb
               + snoise(vec3(sp.x * 6.0, sp.y * 30.0, sp.z * 6.0)) * turb * 0.25;
    float y = p.y + warp;
    float b1 = sin(y * uFreq) * 0.5 + 0.5;
    float b2 = sin(y * uFreq * 2.3 + 1.7) * 0.5 + 0.5;
    vec3 col = mix(uColorA, uColorB, b1);
    col = mix(col, uColorC, smoothstep(0.55, 1.0, b2) * (uKind == 2 ? 0.7 : 0.25));
    col *= 0.95 + 0.1 * fbm(sp * vec3(2.0, 14.0, 2.0));
    if (uSpot.w > 0.0) {
      vec3 sd = normalize(uSpot.xyz);
      float d = distance(normalize(p) * vec3(1.0, 1.7, 1.0), sd * vec3(1.0, 1.7, 1.0));
      float swirl = fbm(sp * 6.0) * 0.04;
      float s = 1.0 - smoothstep(uSpot.w * 0.6, uSpot.w, d + swirl);
      col = mix(col, uSpotColor, s * 0.85);
    }
    return col;
  }
  if (uKind == 4) {
    return vec3(1.0);
  }
  // Rocky / cratered
  float n = fbm(sp * uFreq);
  vec3 col = mix(uColorA, uColorB, smoothstep(-0.45, 0.45, n));
  col = mix(col, uColorC, smoothstep(0.25, 0.6, fbm(sp * uFreq * 2.3 + 3.0)) * 0.6);
  if (uCraters > 0.0) {
    float c = 1.0 - abs(snoise(sp * uFreq * 2.6));
    float rim = smoothstep(0.86, 0.97, c);
    float pit = smoothstep(0.93, 1.0, c);
    col *= 1.0 - pit * 0.35 * uCraters;
    col += rim * 0.08 * uCraters;
  }
  float cap = uCaps > 0.0 ? smoothstep(uCaps - 0.03, uCaps + 0.02, abs(p.y) + fbm(sp * 5.0) * 0.05) : 0.0;
  return mix(col, vec3(0.93, 0.94, 0.97), cap);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Baking: procedural patterns rendered once into cube maps
// ─────────────────────────────────────────────────────────────────────────────
// Evaluating layered noise for every pixel, every frame, is what made large
// bodies (a followed planet, the Sun, the Rocket Lab globe) and the sky so
// expensive on laptop GPUs. Patterns that only depend on direction are rendered
// once into a cube map and sampled by direction afterwards.

const BAKE_VERTEX = /* glsl */ `
varying vec3 vObjPos;
void main() {
  vObjPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Renders `fragmentShader` (which reads `varying vec3 vObjPos`, a direction from
 * the centre) into a cube map of `size`² per face. Colours should be written
 * gamma-encoded (sqrt) so 8 bits keep dark gradients smooth; decode with c * c.
 */
export const bakeCubeMap = (renderer: THREE.WebGLRenderer, fragmentShader: string, size: number, uniforms: Record<string, THREE.IUniform> = {}) => {
  const target = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.ShaderMaterial({ vertexShader: BAKE_VERTEX, fragmentShader, uniforms, side: THREE.BackSide, depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(geometry, material));
  new THREE.CubeCamera(0.1, 10, target).update(renderer, scene);
  geometry.dispose();
  material.dispose();
  return target.texture;
};

/** Rotation of a direction about the y axis, for drifting baked patterns. */
const ROTATE_Y_GLSL = /* glsl */ `
vec3 rotateY(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}
vec3 rotateX(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(d.x, c * d.y - s * d.z, s * d.y + c * d.z);
}
`;

const SURFACE_UNIFORMS_GLSL = /* glsl */ `
uniform int uKind;
uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
uniform vec3 uSeed; uniform float uFreq; uniform float uCaps; uniform float uCraters;
uniform vec4 uSpot; uniform vec3 uSpotColor;
float gOcean = 0.0;
`;

const surfaceUniforms = (opts: SurfaceOptions) => ({
  uKind: { value: KIND_INDEX[opts.kind] },
  uColorA: { value: new THREE.Color(opts.colors[0]) },
  uColorB: { value: new THREE.Color(opts.colors[1]) },
  uColorC: { value: new THREE.Color(opts.colors[2]) },
  uSeed: { value: new THREE.Vector3(opts.seed ?? 0, (opts.seed ?? 0) * 0.37, (opts.seed ?? 0) * 0.71) },
  uFreq: { value: opts.frequency ?? 2.2 },
  uCaps: { value: opts.caps ?? 0 },
  uCraters: { value: opts.craters ?? 0 },
  uSpot: { value: new THREE.Vector4(...(opts.spot ?? [0, 0, 0, 0])) },
  uSpotColor: { value: new THREE.Color(opts.spotColor ?? '#000000') },
});

/** Surface colour (gamma-encoded) with the ocean mask in alpha; clouds store their cover. */
const bakeSurface = (renderer: THREE.WebGLRenderer, opts: SurfaceOptions, size: number) => {
  const body = opts.kind === 'clouds'
    ? `vec3 cp = normalize(vObjPos) * 2.2 + uSeed;
  float cloud = smoothstep(0.05, 0.55, fbm(cp) + 0.35 * fbm(cp * 3.0));
  gl_FragColor = vec4(cloud);`
    : `vec3 col = surfaceColor(normalize(vObjPos));
  gl_FragColor = vec4(sqrt(max(col, 0.0)), gOcean);`;
  return bakeCubeMap(renderer, /* glsl */ `
varying vec3 vObjPos;
${SURFACE_UNIFORMS_GLSL}
${NOISE_GLSL}
${SURFACE_FRAGMENT}
void main() {
  ${body}
}
`, size, surfaceUniforms(opts));
};

const surfaceCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Procedural planet surface on a MeshStandardMaterial (so it keeps PBR lighting).
 * The pattern is baked once into a cube map of `size`² per face; clouds drift by
 * rotating their lookup over time.
 */
export const createSurfaceMaterial = (opts: SurfaceOptions, renderer: THREE.WebGLRenderer, size = 256): THREE.MeshStandardMaterial => {
  const key = `${size}:${JSON.stringify(opts)}`;
  const cached = surfaceCache.get(key);
  if (cached) return cached;

  const isClouds = opts.kind === 'clouds';
  const material = new THREE.MeshStandardMaterial({
    roughness: opts.roughness ?? (opts.kind === 'gas' || opts.kind === 'ice' ? 0.75 : 0.9),
    metalness: 0,
    transparent: isClouds,
    depthWrite: !isClouds,
  });

  const uniforms = {
    uSurfaceMap: { value: bakeSurface(renderer, opts, size) },
    uNightGlow: { value: opts.nightGlow ?? 0.035 },
    uTime: { value: 0 },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObjPos;
uniform samplerCube uSurfaceMap;
uniform float uNightGlow; uniform float uTime;
float gOcean = 0.0;
${ROTATE_Y_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        isClouds
          ? `#include <color_fragment>
float cloud = textureCube(uSurfaceMap, rotateY(normalize(vObjPos), uTime * 0.0065)).r;
diffuseColor = vec4(vec3(1.0), cloud * 0.85);`
          : `#include <color_fragment>
vec4 baked = textureCube(uSurfaceMap, normalize(vObjPos));
diffuseColor.rgb = baked.rgb * baked.rgb;
gOcean = baked.a;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, gOcean);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNightGlow;',
      );
  };
  material.customProgramCacheKey = () => (isClouds ? 'cp-surface-clouds-baked' : 'cp-surface-baked');

  surfaceCache.set(key, material);
  return material;
};

// ─────────────────────────────────────────────────────────────────────────────
// Star photosphere — granulation, sunspots, limb darkening (HDR)
// ─────────────────────────────────────────────────────────────────────────────
// The three noise fields are baked once (granulation, cells, spots in r, g, b);
// motion comes from sampling them along slowly rotating directions.
const starFieldCache = new Map<string, THREE.CubeTexture>();
const bakeStarFields = (renderer: THREE.WebGLRenderer, seed: number) => {
  const key = seed.toFixed(3);
  const cached = starFieldCache.get(key);
  if (cached) return cached;
  const texture = bakeCubeMap(renderer, /* glsl */ `
varying vec3 vObjPos;
uniform float uSeed;
${NOISE_GLSL}
void main() {
  vec3 p = normalize(vObjPos) * 3.0 + uSeed;
  float gran = fbm(p * 2.2);
  float cells = 1.0 - abs(snoise(p * 7.0));
  float spots = fbm3(p * 0.9);
  gl_FragColor = vec4(gran * 0.5 + 0.5, cells, spots * 0.5 + 0.5, 1.0);
}
`, 512, { uSeed: { value: seed } });
  starFieldCache.set(key, texture);
  return texture;
};

export const createStarMaterial = (color: string, intensity: number, renderer: THREE.WebGLRenderer) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(color) },
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uFields: { value: bakeStarFields(renderer, Math.floor(Math.random() * 4) * 2.5) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vObjPos;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      vObjPos = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormalV = normalize(normalMatrix * normal);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uIntensity;
    uniform samplerCube uFields;
    varying vec3 vObjPos;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    ${ROTATE_Y_GLSL}
    void main() {
      vec3 d = normalize(vObjPos);
      float t = uTime;
      // Two copies of the granulation drifting apart read as a boiling surface.
      float g1 = textureCube(uFields, rotateY(d, t * 0.035)).r;
      float g2 = textureCube(uFields, rotateX(rotateY(d, -t * 0.024), 1.7)).r;
      float gran = (g1 + g2 - 1.0) * 1.35;
      float cells = textureCube(uFields, rotateY(d, -t * 0.05)).g;
      float spots = smoothstep(0.55, 0.75, textureCube(uFields, rotateY(d, t * 0.012)).b * 2.0 - 1.0);
      float mu = clamp(dot(normalize(vNormalV), normalize(vViewDir)), 0.0, 1.0);
      float limb = 0.35 + 0.65 * pow(max(mu, 1e-4), 0.45);
      vec3 hot = mix(uColor, vec3(1.0, 0.98, 0.9), 0.55);
      vec3 col = mix(uColor * 0.55, hot, smoothstep(-0.45, 0.55, gran) * 0.75 + cells * 0.25);
      col *= 0.85 + 0.3 * cells;
      col *= 1.0 - spots * 0.6;
      col *= limb;
      // brighten the rim slightly for a corona hint
      col += uColor * pow(1.0 - mu, 3.0) * 0.6;
      gl_FragColor = vec4(col * uIntensity, 1.0);
    }
  `,
  toneMapped: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Fresnel atmosphere shell (additive)
// ─────────────────────────────────────────────────────────────────────────────
export const createAtmosphereMaterial = (color: string, strength = 1.2, power = 3.0) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(color) },
    uStrength: { value: strength },
    uPower: { value: power },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormalV = normalize(normalMatrix * normal);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uPower;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      float rim = clamp(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
      float a = pow(rim, uPower) * uStrength;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.FrontSide,
});

// ─────────────────────────────────────────────────────────────────────────────
// Black-hole accretion disk — differential rotation, temperature gradient,
// relativistic beaming toward the camera
// ─────────────────────────────────────────────────────────────────────────────
export const createAccretionDiskMaterial = (inner: number, outer: number) => new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uInner: { value: inner },
    uOuter: { value: outer },
  },
  vertexShader: /* glsl */ `
    varying vec2 vLocal;
    varying vec3 vWorldPos;
    varying vec3 vTangentW;
    void main() {
      vLocal = position.xy;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vec3 tangent = normalize(vec3(-position.y, position.x, 0.0));
      vTangentW = normalize(mat3(modelMatrix) * tangent);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uInner;
    uniform float uOuter;
    varying vec2 vLocal;
    varying vec3 vWorldPos;
    varying vec3 vTangentW;
    ${NOISE_GLSL}
    void main() {
      float r = length(vLocal);
      float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
      float omega = 1.6 / pow(max(r / uInner, 1.0), 1.5);
      float a = uTime * omega;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * vLocal / uInner;
      float streaks = fbm(vec3(q * 1.3, uTime * 0.05));
      float fine = snoise(vec3(q * 4.0, uTime * 0.1));
      float density = (0.65 + 0.45 * streaks + 0.15 * fine);
      vec3 white = vec3(1.0, 0.96, 0.9);
      vec3 gold = vec3(1.0, 0.72, 0.32);
      vec3 ember = vec3(0.85, 0.25, 0.06);
      vec3 col = mix(white, gold, smoothstep(0.0, 0.35, t));
      col = mix(col, ember, smoothstep(0.35, 1.0, t));
      float beaming = 1.0 + 0.75 * dot(normalize(vTangentW), normalize(cameraPosition - vWorldPos));
      float alpha = clamp(smoothstep(0.0, 0.06, t) * pow(max(1.0 - t, 0.0), 1.6) * density, 0.0, 1.0);
      float glow = mix(2.1, 0.55, t) * beaming;
      gl_FragColor = vec4(col * glow * alpha, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Planetary ring system (Saturn / Uranus) with banded density
// ─────────────────────────────────────────────────────────────────────────────
export const createRingMaterial = (inner: number, outer: number, color: string, opacity = 0.85, seed = 1) => new THREE.ShaderMaterial({
  uniforms: {
    uInner: { value: inner },
    uOuter: { value: outer },
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: opacity },
    uSeed: { value: seed },
  },
  vertexShader: /* glsl */ `
    varying vec2 vLocal;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      vLocal = position.xy;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormalV = normalize(normalMatrix * normal);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uInner;
    uniform float uOuter;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uSeed;
    varying vec2 vLocal;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    ${NOISE_GLSL}
    void main() {
      float r = length(vLocal);
      float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
      float bands = 0.55 + 0.45 * snoise(vec3(t * 38.0, uSeed, 0.0));
      bands *= 0.75 + 0.25 * snoise(vec3(t * 140.0, uSeed * 2.0, 0.0));
      float cassini = 1.0 - smoothstep(0.0, 0.015, abs(t - 0.62)) * 0.9;
      float edge = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.92, t);
      float lit = 0.55 + 0.45 * abs(dot(normalize(vNormalV), normalize(vViewDir)));
      float a = clamp(bands, 0.0, 1.0) * cassini * edge * uOpacity;
      vec3 col = uColor * (0.75 + 0.35 * bands) * lit;
      gl_FragColor = vec4(col, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// ─────────────────────────────────────────────────────────────────────────────
// Beam / tail cone — fades along its length (additive)
// ─────────────────────────────────────────────────────────────────────────────
export const createBeamMaterial = (color: string, intensity = 1.6, flicker = 0) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(color) },
    uIntensity: { value: intensity },
    uTime: { value: 0 },
    uFlicker: { value: flicker },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vObjPos;
    void main() {
      vUv = uv;
      vObjPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uFlicker;
    varying vec2 vUv;
    varying vec3 vObjPos;
    ${NOISE_GLSL}
    void main() {
      // uv.y = 1 at the apex (source), 0 at the open end
      // Clamp before pow(): D3D returns NaN for pow(<0, y), which bloom then smears across the frame
      float along = clamp(vUv.y, 0.0, 1.0);
      float fade = pow(along, 1.4);
      float side = clamp(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
      float n = 1.0;
      if (uFlicker > 0.0) {
        n = 0.7 + 0.5 * snoise(vec3(vObjPos * 3.0 + vec3(0.0, uTime * 3.0, 0.0)));
      }
      float a = clamp(fade * (0.6 + 0.4 * side) * n, 0.0, 1.0);
      gl_FragColor = vec4(uColor * uIntensity * a, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Soft radial glow sprite texture (shared)
// ─────────────────────────────────────────────────────────────────────────────
let glowTexture: THREE.CanvasTexture | null = null;
export const getGlowTexture = () => {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
};

/** Soft round particle texture for flames and smoke. */
let softDotTexture: THREE.CanvasTexture | null = null;
export const getSoftDotTexture = () => {
  if (softDotTexture) return softDotTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  softDotTexture = new THREE.CanvasTexture(canvas);
  return softDotTexture;
};

// ─────────────────────────────────────────────────────────────────────────────
// Irregular rock geometry (asteroids, comet nuclei)
// ─────────────────────────────────────────────────────────────────────────────
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

const valueNoise3 = (x: number, y: number, z: number, seed: number) => {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const h = (a: number, b: number, c: number) => hash(a * 157 + b * 113 + c * 271 + seed * 31);
  const u = s(xf); const v = s(yf); const w = s(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
  const x10 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
  const x01 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
  const x11 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
};

const rockCache = new Map<number, THREE.BufferGeometry>();
export const createRockGeometry = (seed: number, roughness = 0.32) => {
  const key = Math.round(seed * 1000) % 12; // a dozen shapes shared across bodies
  const cached = rockCache.get(key);
  if (cached) return cached;
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const stretch = new THREE.Vector3(1 + hash(key) * 0.35, 0.8 + hash(key + 3) * 0.25, 0.85 + hash(key + 7) * 0.3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let n = 0;
    let amp = 1;
    let freq = 1.4;
    for (let o = 0; o < 4; o++) {
      n += (valueNoise3(v.x * freq + 10, v.y * freq + 10, v.z * freq + 10, key + o) - 0.5) * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    const r = 1 + n * roughness * 1.6;
    v.multiply(stretch).multiplyScalar(r / 1.1);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  rockCache.set(key, geo);
  return geo;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fading trail line (alpha ramps up toward the body)
// ─────────────────────────────────────────────────────────────────────────────
export const createTrailMaterial = (color: string, opacity = 0.55) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(color) },
    uCount: { value: 1 },
    uOpacity: { value: opacity },
  },
  vertexShader: /* glsl */ `
    uniform float uCount;
    varying float vT;
    void main() {
      vT = float(gl_VertexID) / max(uCount - 1.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vT;
    void main() {
      float a = pow(clamp(vT, 0.0, 1.0), 1.6) * uOpacity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
