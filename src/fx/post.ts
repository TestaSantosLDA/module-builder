// Tone mapping, "photo look" and screen-space AO, shared with the apartment walkthrough (its web/viewer.js has the same
// AgX look contrast, look pass and GTAO settings). Two paths:
//   leve: direct render to the canvas (MSAA from the canvas), AgX + look contrast in the material shaders. No extra
//         render targets: cheapest on phones and tablets.
//   alto: HDR composer (half float, MSAA 4) -> GTAO -> bloom (only light far above white) -> look (white balance +
//         vignette) -> OutputPass (AgX + sRGB) -> SMAA. Bloom and SMAA are the apartment's settings.
// fx.on = false keeps the old pipeline: ACES Filmic, no composer.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Fx } from './quality';

/** AgX with the "Medium High Contrast" look of the Cycles photos: three r160 has plain AgX only, so the log-encoded
 * value gets more contrast around middle grey before the sigmoid. Call once, before any material compiles. */
let lookInstalled = false;
export function installAgxLook(contrast = 1.2): void {
  if (lookInstalled) return; lookInstalled = true;
  const pivot = ((Math.log2(0.18) + 12.47393) / (4.026069 + 12.47393)).toFixed(4);
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'color = agxDefaultContrastApprox( color );',
    `color = clamp( ( color - ${pivot} ) * ${contrast.toFixed(2)} + ${pivot}, 0.0, 1.0 );   // look
	color = agxDefaultContrastApprox( color );`);
}

/** White balance + vignette, in linear light before the tone curve (same shader as the apartment's LOOK pass). */
export const LOOK_SHADER = {
  uniforms: { tDiffuse: { value: null }, wb: { value: new THREE.Vector3(1, 1, 1) }, vignette: { value: 0.16 }, aspect: { value: 16 / 9 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec3 wb; uniform float vignette, aspect;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / length(vec2(aspect, 1.0)) * 2.0;   // 1 at the corners
  c.rgb *= wb * (1.0 - vignette * smoothstep(0.35, 1.0, dot(d, d)));
  gl_FragColor = c;
}`,
};

export interface PostOptions {
  exposure?: number;
  /** bloom strength, radius and threshold (linear, before exposure) */
  bloom?: [number, number, number];
  /** GTAO radius in metres and blend strength */
  aoRadius?: number;
  aoIntensity?: number;
}
export interface Post {
  render(): void;
  setSize(width: number, height: number): void;
  /** frame-time watchdog: call with ms per frame; turns AO off for good if the median of ~3 s of frames > 40 ms */
  watch(ms: number, now: number): void;
  readonly composer: EffectComposer | null;
}

export function rendererOptions(fx: Fx): THREE.WebGLRendererParameters {
  // with the composer, anti-aliasing is MSAA on its HDR target instead of the canvas
  return { antialias: !(fx.on && fx.tier === 'alto'), powerPreference: 'high-performance' };
}

export function setupRenderer(renderer: THREE.WebGLRenderer, fx: Fx, opts: PostOptions = {}): void {
  renderer.setPixelRatio(Math.min(fx.maxPixelRatio, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (fx.on) {
    if (fx.look) installAgxLook();
    renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = opts.exposure ?? 1;
  } else { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, fx: Fx, opts: PostOptions = {}): Post {
  if (!fx.on || fx.tier === 'leve') {
    return { composer: null, render: () => renderer.render(scene, camera), setSize: () => {}, watch: () => {} };
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let ao: GTAOPass | null = null;
  if (fx.ao) {
    ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: opts.aoRadius ?? 0.6, distanceFallOff: 1, thickness: 1, scale: 1, samples: 16 });
    ao.blendIntensity = opts.aoIntensity ?? 0.85;
    composer.addPass(ao);
  }
  if (fx.bloom) {
    const [k, r, t] = opts.bloom ?? [0.12, 0.35, 2.5];
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), k, r, t));
  }
  const look = new ShaderPass(LOOK_SHADER); look.enabled = fx.look; composer.addPass(look);
  composer.addPass(new OutputPass());
  if (fx.smaa) composer.addPass(new SMAAPass(size.x, size.y));
  const watch = { from: performance.now() + 5000, times: [] as number[], until: 0 };
  return {
    composer,
    render() { look.uniforms.aspect.value = camera.aspect; composer.render(); },
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    watch(ms, now) {
      if (!ao?.enabled || now < watch.from) return;
      watch.times.push(ms);
      if (now < watch.until) return;
      const t = watch.times.sort((a, b) => a - b), med = t[t.length >> 1] || 0;
      watch.times = []; watch.until = now + 3000;
      if (med > 40 && watch.times.length === 0 && t.length >= 20) { ao.enabled = false; console.info(`Frames lentos (${med.toFixed(0)} ms): AO de ecrã desligado.`); }
    },
  };
}
