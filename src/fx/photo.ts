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
  let result!: T, lost = false, dark = false;
  const gl = renderer.getContext(), canvas = renderer.domElement, px = new Uint8Array(4);
  const onLost = () => { lost = true; };
  canvas.addEventListener('webglcontextlost', onLost);
  // GPU calls return at once: without waiting for the GPU, one frame could queue hundreds of samples, take seconds and make
  // the driver reset the GPU (the photo comes out black). Each frame reads one pixel back, which waits for the samples
  // queued so far, and the number of samples per frame follows the measured time (about 25 ms per frame).
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let k = 1;
  await new Promise<void>(done => {
    const step = () => {
      if (lost) { done(); return; }
      const f0 = performance.now();
      for (let i = 0; i < k && pt.samples < o.samples; i++) pt.renderSample();
      sync();
      const dt = performance.now() - f0;
      if (pt.samples > 0) k = dt < 12 ? Math.min(16, k * 2) : dt > 40 ? Math.max(1, k >> 1) : k;
      if (!t0 && pt.samples > 0) t0 = performance.now();
      const el = t0 ? performance.now() - t0 : 0;
      o.onProgress?.(Math.min(1, Math.max(pt.samples / o.samples, el / o.maxMs)));
      if (pt.samples >= o.samples || el >= o.maxMs || o.stop?.now) {
        // a black picture means the GPU could not run the path tracer: say so instead of showing it
        renderer.setRenderTarget(null); dark = true;
        for (let i = 1; i < 6 && dark; i++) for (let j = 1; j < 6 && dark; j++) {
          gl.readPixels(Math.floor(canvas.width * i / 6), Math.floor(canvas.height * j / 6), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (px[0] + px[1] + px[2] > 12) dark = false;
        }
        if (!dark && !gl.isContextLost()) result = grab();
        done();
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  canvas.removeEventListener('webglcontextlost', onLost);
  if (lost || dark || gl.isContextLost()) {
    console.warn('Fotografia realista falhou', { lost, dark, samples: pt.samples, gpu: gpuName(gl) });
    try { pt.dispose(); } catch { /* ignore */ }
    throw new Error(lost || gl.isContextLost() ? 'gpu-reset' : 'black');
  }
  const n = Math.floor(pt.samples);
  try { pt.dispose(); } catch { /* older versions dispose a missing quad */ }
  return { samples: n, result };
}

/** Graphics card name, for the console when a photo fails. */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}
