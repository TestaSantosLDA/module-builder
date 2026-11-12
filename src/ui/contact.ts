// Contact shadows painted from the plan (layer 4 of the 3D light): soft darkening around module footprints, as an
// alpha texture for a black overlay plane. Cheap on every device: computed once per change of the plan, not per frame.
import * as THREE from 'three';
import type { Rect } from '../model/geometry';

export interface ContactOptions {
  /** metres of texture around the footprints */
  margin: number;
  /** blur radius, metres */
  blur: number;
  /** darkness at the centre, 0..1 */
  strength: number;
  /** footprints grown by this much, metres, before blurring */
  grow: number;
}
export interface Contact { texture: THREE.DataTexture; x0: number; z0: number; x1: number; z1: number }

/** Footprints in plan dm -> alpha grid in world metres. Row 0 is the far edge (z1), as a -90° X-rotated plane maps it. */
export function contactGrid(rects: Rect[], o: ContactOptions, maxSize = 512): { a: Float32Array; w: number; h: number; ppm: number; x0: number; z0: number; x1: number; z1: number } {
  const x0 = Math.min(...rects.map(r => r.x)) / 10 - o.margin, x1 = Math.max(...rects.map(r => r.x + r.w)) / 10 + o.margin;
  const z0 = Math.min(...rects.map(r => r.y)) / 10 - o.margin, z1 = Math.max(...rects.map(r => r.y + r.h)) / 10 + o.margin;
  const ppm = Math.min(16, maxSize / Math.max(x1 - x0, z1 - z0));
  const w = Math.max(4, Math.ceil((x1 - x0) * ppm)), h = Math.max(4, Math.ceil((z1 - z0) * ppm));
  let a = new Float32Array(w * h);
  for (const r of rects) {
    const i0 = Math.max(0, Math.floor((r.x / 10 - o.grow - x0) * ppm)), i1 = Math.min(w, Math.ceil(((r.x + r.w) / 10 + o.grow - x0) * ppm));
    const j0 = Math.max(0, Math.floor((z1 - (r.y + r.h) / 10 - o.grow) * ppm)), j1 = Math.min(h, Math.ceil((z1 - r.y / 10 + o.grow) * ppm));
    for (let j = j0; j < j1; j++) a.fill(1, j * w + i0, j * w + i1);
  }
  // three box blurs ≈ a gaussian
  const rad = Math.max(1, Math.round(o.blur * ppm / 1.7));
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < h; j++) { let s = 0; for (let i = -rad; i <= rad; i++) s += a[j * w + Math.min(w - 1, Math.max(0, i))];
      for (let i = 0; i < w; i++) { tmp[j * w + i] = s / (2 * rad + 1); s += a[j * w + Math.min(w - 1, i + rad + 1)] - a[j * w + Math.max(0, i - rad)]; } }
    for (let i = 0; i < w; i++) { let s = 0; for (let j = -rad; j <= rad; j++) s += tmp[Math.min(h - 1, Math.max(0, j)) * w + i];
      for (let j = 0; j < h; j++) { a[j * w + i] = s / (2 * rad + 1); s += tmp[Math.min(h - 1, j + rad + 1) * w + i] - tmp[Math.max(0, j - rad) * w + i]; } }
  }
  for (let k = 0; k < a.length; k++) a[k] *= o.strength;
  return { a, w, h, ppm, x0, z0, x1, z1 };
}

export function paintContact(rects: Rect[], o: ContactOptions): Contact {
  const g = contactGrid(rects, o), px = new Uint8Array(g.w * g.h * 4);
  for (let k = 0; k < g.a.length; k++) { const v = Math.round(g.a[k] * 255); px[4 * k] = px[4 * k + 1] = px[4 * k + 2] = v; px[4 * k + 3] = 255; }
  const texture = new THREE.DataTexture(px, g.w, g.h, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return { texture, x0: g.x0, z0: g.z0, x1: g.x1, z1: g.z1 };
}
