/**
 * The visual "rubber sheet": a height field that dips under each mass.
 *
 * Each body contributes a softened 1/r well (a Plummer profile):
 *   depth_i(r) = k_i · s_i / √(r² + s_i²)
 * where k_i grows with log mass and s_i with the body's size, so wells are
 * smooth funnels rather than spikes. The sum is eased toward MAX_DEPTH so
 * a black hole reads as deepest without swallowing the whole view.
 *
 * The same formula runs in the grid's vertex shader (WELL_GLSL) and on the CPU
 * (surfaceHeight) so bodies, trails and predicted paths sit on the surface.
 * Purely visual: physics stays on the y = 0 plane.
 */
import * as THREE from 'three';

export const MAX_WELLS = 32;
const MAX_DEPTH = 11;
const LOG_MASS_MIN = 22;
const LOG_MASS_MAX = 31.5;

export interface WellSource {
  position: { x: number; z: number };
  mass: number;
  radius: number;
}

/** Live well list (x, z, k, s per well), refreshed once per frame by the simulator. */
export const wellField = {
  data: new Float32Array(MAX_WELLS * 4),
  count: 0,
};

/** Depth at the centre of a body's well: 0.5 for small rocks up to ~9.5 for black holes. */
export const wellStrength = (mass: number) => {
  const normalized = THREE.MathUtils.clamp((Math.log10(Math.max(mass, 1)) - LOG_MASS_MIN) / (LOG_MASS_MAX - LOG_MASS_MIN), 0, 1);
  return 0.5 + 9 * normalized * normalized;
};

export const wellSoftness = (radius: number) => Math.max(radius * 1.6, 1.2);

const scratch: { k: number; x: number; z: number; s: number }[] = [];

export const updateWells = (sources: readonly WellSource[]) => {
  scratch.length = 0;
  for (const source of sources) {
    scratch.push({ x: source.position.x, z: source.position.z, k: wellStrength(source.mass), s: wellSoftness(source.radius) });
  }
  // Keep the strongest wells when there are more bodies than shader slots.
  if (scratch.length > MAX_WELLS) scratch.sort((a, b) => b.k - a.k);
  const count = Math.min(scratch.length, MAX_WELLS);
  for (let i = 0; i < count; i++) {
    const w = scratch[i];
    wellField.data.set([w.x, w.z, w.k, w.s], i * 4);
  }
  wellField.count = count;
};

/** Overlapping wells deepen smoothly toward MAX_DEPTH instead of spiking. */
const easeDepth = (sum: number) => MAX_DEPTH * (1 - Math.exp(-sum / MAX_DEPTH));

/** Height of the sheet at (x, z); always ≤ 0. */
export const surfaceHeight = (x: number, z: number, data = wellField.data, count = wellField.count) => {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const dx = x - data[i * 4];
    const dz = z - data[i * 4 + 1];
    const s = data[i * 4 + 3];
    sum += (data[i * 4 + 2] * s) / Math.sqrt(dx * dx + dz * dz + s * s);
  }
  return -easeDepth(sum);
};

/** GLSL twin of surfaceHeight; expects uWells[MAX_WELLS] and uWellCount uniforms. */
export const WELL_GLSL = /* glsl */ `
  uniform vec4 uWells[${MAX_WELLS}];
  uniform int uWellCount;
  float wellSum(vec2 p) {
    float sum = 0.0;
    for (int i = 0; i < ${MAX_WELLS}; i++) {
      if (i >= uWellCount) break;
      vec4 w = uWells[i];
      vec2 d = p - w.xy;
      sum += (w.z * w.w) / sqrt(dot(d, d) + w.w * w.w);
    }
    return sum;
  }
  float surfaceDepth(vec2 p) {
    return ${MAX_DEPTH.toFixed(1)} * (1.0 - exp(-wellSum(p) / ${MAX_DEPTH.toFixed(1)}));
  }
`;
