// "Fotografia realista": the current 3D view rendered with a path tracer (three-gpu-pathtracer, MIT) in the browser.
// Light bounces between the modules, real soft shadows and real glass, from the same sky and sun as the 3D view.
// Loaded only when the button is pressed (about 200 KB gzip); nothing changes in the normal 3D view.
import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

export interface PhotoOptions {
  /** stop after this many samples per pixel */
  samples: number;
  /** or after this many milliseconds, whichever comes first */
  maxMs: number;
  /** progress 0..1 */
  onProgress?(p: number): void;
  /** set to true to stop early: the photo is made from the samples so far */
  stop?: { now: boolean };
}

/** Path-traces scene/camera into the renderer's canvas (at its current size); grab() reads the canvas right after the
 * last sample (the drawing buffer is not preserved between frames). */
export async function pathTrace<T>(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: PhotoOptions, grab: () => T): Promise<{ samples: number; result: T }> {
  // three r160 has no background/environment rotation; the path tracer reads them (also from its own empty scene)
  const proto = THREE.Scene.prototype as THREE.Scene & { backgroundRotation?: THREE.Euler; environmentRotation?: THREE.Euler };
  proto.backgroundRotation ??= new THREE.Euler(); proto.environmentRotation ??= new THREE.Euler();
  const pt = new WebGLPathTracer(renderer);
  pt.renderDelay = 0; pt.fadeDuration = 0; pt.minSamples = 1; pt.renderScale = 1;
  pt.tiles.set(2, 2); // smaller GPU jobs: keeps the page responsive and avoids driver time-outs on weak GPUs
  pt.bounces = 6; pt.transmissiveBounces = 6; pt.filterGlossyFactor = 0.5; pt.multipleImportanceSampling = true;
  pt.textureSize.set(1024, 1024);
  pt.setScene(scene, camera); // the houses are small: building the BVH on the main thread takes well under a second
  let t0 = 0; // the clock starts at the first sample, after the shader has compiled
  let result!: T;
  await new Promise<void>(done => {
    const step = () => {
      // a few samples per frame on fast GPUs, one on slow ones
      const f0 = performance.now();
      do pt.renderSample(); while (performance.now() - f0 < 12 && pt.samples < o.samples);
      if (!t0 && pt.samples > 0) t0 = performance.now();
      const el = t0 ? performance.now() - t0 : 0;
      o.onProgress?.(Math.min(1, Math.max(pt.samples / o.samples, el / o.maxMs)));
      if (pt.samples >= o.samples || el >= o.maxMs || o.stop?.now) { result = grab(); done(); } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const n = Math.floor(pt.samples);
  try { pt.dispose(); } catch { /* older versions dispose a missing quad */ }
  return { samples: n, result };
}
