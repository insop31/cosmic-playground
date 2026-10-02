// Struct-of-arrays storage for the N-body engine. Bodies live in flat typed arrays so
// the force loop and integrator never allocate; removal swaps the last body into the gap.

export const MOTION_BOUND = 0;
export const MOTION_ESCAPING = 1;
export const MOTION_CAPTURED = 2;

export interface BodyInit {
  id: string;
  type: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  mass: number;
  radius: number;
  pinned?: boolean;
}

export class NBodySystem {
  count = 0;
  capacity: number;
  ids: string[] = [];
  types: string[] = [];
  px: Float64Array;
  pz: Float64Array;
  vx: Float64Array;
  vz: Float64Array;
  ax: Float64Array;
  az: Float64Array;
  mass: Float64Array;
  radius: Float64Array;
  pinned: Uint8Array;
  motion: Uint8Array;
  closeApproach: Uint8Array;
  /** Index of the body each body is classified against (−1 when none). */
  dominant: Int32Array;
  /** True when ax/az hold the accelerations for the current positions and masses. */
  accValid = false;
  private indexById = new Map<string, number>();

  constructor(capacity = 32) {
    this.capacity = capacity;
    this.px = new Float64Array(capacity);
    this.pz = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vz = new Float64Array(capacity);
    this.ax = new Float64Array(capacity);
    this.az = new Float64Array(capacity);
    this.mass = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.pinned = new Uint8Array(capacity);
    this.motion = new Uint8Array(capacity);
    this.closeApproach = new Uint8Array(capacity);
    this.dominant = new Int32Array(capacity).fill(-1);
  }

  private grow() {
    const next = this.capacity * 2;
    const growF = (a: Float64Array) => { const b = new Float64Array(next); b.set(a); return b; };
    const growU = (a: Uint8Array) => { const b = new Uint8Array(next); b.set(a); return b; };
    this.px = growF(this.px); this.pz = growF(this.pz);
    this.vx = growF(this.vx); this.vz = growF(this.vz);
    this.ax = growF(this.ax); this.az = growF(this.az);
    this.mass = growF(this.mass); this.radius = growF(this.radius);
    this.pinned = growU(this.pinned); this.motion = growU(this.motion);
    this.closeApproach = growU(this.closeApproach);
    const dom = new Int32Array(next).fill(-1);
    dom.set(this.dominant);
    this.dominant = dom;
    this.capacity = next;
  }

  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  has(id: string): boolean {
    return this.indexById.has(id);
  }

  add(body: BodyInit): number {
    if (this.indexById.has(body.id)) throw new Error(`Body ${body.id} already exists`);
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    this.ids[i] = body.id;
    this.types[i] = body.type;
    this.px[i] = body.x;
    this.pz[i] = body.z;
    this.vx[i] = body.vx;
    this.vz[i] = body.vz;
    this.ax[i] = 0;
    this.az[i] = 0;
    this.mass[i] = body.mass;
    this.radius[i] = body.radius;
    this.pinned[i] = body.pinned ? 1 : 0;
    this.motion[i] = MOTION_BOUND;
    this.closeApproach[i] = 0;
    this.dominant[i] = -1;
    this.indexById.set(body.id, i);
    this.accValid = false;
    return i;
  }

  removeAt(i: number) {
    const last = this.count - 1;
    const removedId = this.ids[i];
    if (i !== last) {
      this.ids[i] = this.ids[last];
      this.types[i] = this.types[last];
      this.px[i] = this.px[last];
      this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last];
      this.vz[i] = this.vz[last];
      this.ax[i] = this.ax[last];
      this.az[i] = this.az[last];
      this.mass[i] = this.mass[last];
      this.radius[i] = this.radius[last];
      this.pinned[i] = this.pinned[last];
      this.motion[i] = this.motion[last];
      this.closeApproach[i] = this.closeApproach[last];
      this.dominant[i] = this.dominant[last];
      this.indexById.set(this.ids[i], i);
    }
    this.ids.length = last;
    this.types.length = last;
    this.indexById.delete(removedId);
    this.count = last;
    this.accValid = false;
  }

  remove(id: string): boolean {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.removeAt(i);
    return true;
  }

  clear() {
    this.count = 0;
    this.ids = [];
    this.types = [];
    this.indexById.clear();
    this.accValid = false;
  }
}
