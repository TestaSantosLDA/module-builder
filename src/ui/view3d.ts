// 3D view: modules built from the Blender kit (public/kit) on a grass ground under a real sky, drag and stack in 3D.
// Units: plan is in dm, the scene in metres. Loaded only when the 3D tab is first opened (dynamic import in main.ts).
//
// Light for any combination of modules (realism plan, phase 1), in layers that never need the whole house in advance:
//   1. HDRI sky (Poly Haven, CC0) for ambient light and reflections; the sun of that HDRI is the shadow-casting light
//   2. real-time sun shadows, the shadow box fitted to the house
//   3. ambient occlusion inside each module, in module space (wall foot, under the flashing, room corners, reveals)
//   4. contact shadows on the ground and on decks, painted from the plan; screen-space GTAO on the desktop tier
//   5. a soft interior glow per room type, seen through the glass
// ?fx=0 shows the 3D as it was before (studio light, paper background); see src/fx/quality.ts for the other flags.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MAX_LEVEL, STOREY, TYPES, type Mod } from '../model/catalog';
import { footprint as fp, level as lv, outWalls, overlaps, sides, type Door } from '../model/geometry';
import { OPENINGS, pieceOf, widthOf } from '../model/openings';
import { browserFx } from '../fx/quality';
import { createPost, rendererOptions, setupRenderer } from '../fx/post';
import { paintContact } from './contact';

export type Finish = 'branco' | 'madeira' | 'grafite';

export interface View3DHost {
  /** folder with kit.glb and the textures, ending in '/' */
  kitUrl: string;
  /** folder with the Basis transcoder (basis_transcoder.js/.wasm), ending in '/' */
  basisUrl: string;
  getMods(): Mod[];
  select(m: Mod | null): void;
  /** the plan or the selection changed: re-render everything */
  changed(): void;
  /** the camera moved: reposition the selection toolbar */
  selectionMoved(): void;
  snap(m: Mod): void;
  /** a wall was clicked without dragging: side of the module and the point hit (plan dm), and the screen point */
  wallClick(m: Mod, side: 'N' | 'S' | 'W' | 'E', x: number, y: number, clientX: number, clientY: number): void;
}

export interface View3D {
  build(mods: Mod[], sel: Mod | null, bad: Set<Mod>, ds: Door[]): void;
  screenOf(m: Mod, rect: DOMRect): { x: number; y: number };
  dolly(k: number): void;
  startDrag(m: Mod): void;
  place(m: Mod, clientX: number, clientY: number): void;
  endDrag(): void;
  dragging(): boolean;
  frame(mods: Mod[]): void;
  resize(): void;
  start(): void;
  stop(): void;
  setFinish(f: Finish): void;
  /** renders a 960×600 JPEG of the house for the quote request */
  capture(mods: Mod[], bad: Set<Mod>, ds: Door[]): string | null;
  /** true once the sky has loaded and a realistic photo can be made */
  canPhoto(): boolean;
  /** "Fotografia realista": the current view, path traced; a JPEG data URL (null if not available) */
  photo(mods: Mod[], ds: Door[], o: PhotoRequest): Promise<string | null>;
}

export interface PhotoRequest { width: number; height: number; samples: number; maxMs: number; onProgress?(p: number): void; stop?: { now: boolean } }

const WH = STOREY / 10; // storey height, m
const BASE = 0.3; // modules sit on footings 30 cm above the ground
const T = 0.2; // wall thickness
const FL = 0.25; // floor build-up
const ROOFT = 0.3; // roof slab
/** Facade finishes: real wood scans (Poly Haven, CC0) in public/kit/fachada; size = metres covered by one texture tile. */
const FACADE: Record<Finish, { size: number; normal: number }> = { branco: { size: 1.8, normal: 0.8 }, madeira: { size: 1.13, normal: 1 }, grafite: { size: 1.6, normal: 1 } };
/** Interior glow per room category, seen through the windows (emissive on the ceiling: colour, strength). */
const GLOW: Record<string, [number, number]> = { sala: [0xffcf98, 0.9], quarto: [0xffd9ad, 0.55], wc: [0xfff1e0, 0.6], circ: [0xffe2c0, 0.6], escada: [0xffe2c0, 0.55] };

/** Furniture sets of the web kit: room sketch -> module size they were made for (w × d, m, unrotated). */
const FURN: Record<string, [number, number]> = { sala: [3.8, 3.5], cozinha: [2.8, 3.5], entrada: [3.8, 3.5], quarto: [2.8, 3.5], suite: [3.8, 3.5], escada: [2.8, 3.5] };

const noRay = <O extends THREE.Object3D>(o: O): O => { o.traverse(n => { n.raycast = () => {}; }); return o; };
function boxAt(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, round = 0): THREE.Mesh {
  const g = meterUV(round > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d));
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m); return m;
}
function placeAt<O extends THREE.Object3D>(obj: O, cx: number, y: number, cz: number, nx: number, nz: number, off: number): O {
  const r = Math.atan2(nx, nz); obj.rotation.y = r; obj.position.set(cx + Math.cos(r) * off, y, cz - Math.sin(r) * off); return obj;
}
/** UVs in metres from the positions, by the dominant axis of each normal (so tiled textures keep their real size on any shape). */
function meterUV<G extends THREE.BufferGeometry>(g: G): G {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[2 * i] = u; uv[2 * i + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
/** Per-vertex data for the in-module AO: x = height above the module base, y/z = distance to the two ends of the wall
 * (interior corners), w = 1 on reveal faces. Linear in each triangle, so the shader can shade big faces exactly. */
function setAO(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, i: number) => [number, number, number, number]): void {
  const p = g.attributes.position, a = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) a.set(f(p.getX(i), p.getY(i), p.getZ(i), i), 4 * i);
  g.setAttribute('aoInfo', new THREE.BufferAttribute(a, 4));
}
/** Adds the in-module AO to a material: it darkens only the indirect (sky) light, like real occlusion. */
function withModuleAO<M extends THREE.MeshStandardMaterial>(mat: M, kind: 'ext' | 'int'): M {
  const top = kind === 'ext' ? WH : WH - ROOFT;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aoInfo;\nvarying vec4 vAoInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAoInfo = aoInfo;');
    const ao = kind === 'ext'
      ? `mix(0.45, 1.0, smoothstep(0.0, 0.5, vAoInfo.x)) * mix(0.6, 1.0, smoothstep(0.0, 0.3, ${top.toFixed(3)} - vAoInfo.x)) * mix(1.0, 0.65, vAoInfo.w)`
      : `mix(0.45, 1.0, smoothstep(0.0, 0.45, vAoInfo.x - ${FL.toFixed(3)})) * mix(0.55, 1.0, smoothstep(0.0, 0.45, ${top.toFixed(3)} - vAoInfo.x))
         * mix(0.45, 1.0, smoothstep(0.0, 0.5, min(vAoInfo.y, vAoInfo.z))) * mix(1.0, 0.65, vAoInfo.w)`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vAoInfo;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      { float mAO = ${ao}; reflectedLight.indirectDiffuse *= mAO; reflectedLight.indirectSpecular *= mAO; }`);
  };
  mat.customProgramCacheKey = () => `module-ao-${kind}`;
  return mat;
}

export function createView3D(box: HTMLElement, host: View3DHost): View3D | null {
  const fx = browserFx();
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer(rendererOptions(fx)); } catch { return null; }
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  setupRenderer(renderer, fx, { exposure: 1.15 });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  box.appendChild(renderer.domElement);

  let dirty = true;
  const invalidate = () => { dirty = true; };
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 5; controls.maxDistance = 90;
  const post = createPost(renderer, scene, cam, fx, { aoRadius: 0.7, aoIntensity: 0.9 });

  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6 * Math.PI); sun.castShadow = true;
  sun.shadow.mapSize.set(fx.shadowMapSize, fx.shadowMapSize); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-18, 30, 22).normalize();

  const ktx = new KTX2Loader().setTranscoderPath(host.basisUrl).detectSupport(renderer);
  const ktxTex = (f: string, srgb: boolean, rx: number, ry: number): Promise<THREE.Texture> => new Promise((ok, fail) => ktx.load(host.kitUrl + f, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; ok(t);
  }, undefined, fail));

  // ---------- sky, sky light and ground ----------
  let envHdr: THREE.Texture | null = null;
  const grid = new THREE.Group();
  for (const [n, c1, c2, y] of [[200, 0x5f86ad, 0x2a5580, 0.005], [40, 0x8fb3d6, 0x8fb3d6, 0.01]] as const) {
    const g = new THREE.GridHelper(200, n, c1, c2); g.position.y = y; (g.material as THREE.Material).transparent = true; (g.material as THREE.Material).opacity = fx.sky ? 0.22 : 0.35; grid.add(g);
  }
  scene.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: css('--paper-deep'), roughness: 1, envMapIntensity: 0.15 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  if (fx.sky) {
    grid.visible = false; // the plan grid only shows while a module is being dragged
    scene.background = new THREE.Color(0xb9c9d8);
    scene.fog = new THREE.Fog(0xb9c9d8, 90, 200);
    const gm = ground.material as THREE.MeshStandardMaterial;
    Object.assign(gm, { color: new THREE.Color(0xffffff), envMapIntensity: 1 });
    // colour from an aerial scan (one tile = 9 m: no visible repeats), relief and roughness from a close-up (2.6 m)
    const C = 400 / 9, R = 400 / 2.6;
    void Promise.all([ktxTex('relva/campo_cor.ktx2', true, C, C), ktxTex('relva/relva_nor.ktx2', false, R, R), ktxTex('relva/relva_arm.ktx2', false, R, R)]).then(([c, n, arm]) => {
      Object.assign(gm, { map: c, normalMap: n, normalScale: new THREE.Vector2(0.8, 0.8), aoMap: arm, roughnessMap: arm }); gm.needsUpdate = true; invalidate();
    }).catch(e => console.warn('Relva não carregou', e));
    void fetch(host.kitUrl + 'ceu/ceu.json').then(r => r.json()).then((info: { bgScale: number; horizon: number[]; sun: number[]; sunIrradiance: number }) => {
      sunDir.fromArray(info.sun).normalize();
      sun.color.set(0xffffff); sun.intensity = info.sunIrradiance;
      const haze = new THREE.Color().setRGB(info.horizon[0], info.horizon[1], info.horizon[2], THREE.LinearSRGBColorSpace);
      (scene.fog as THREE.Fog).color.copy(haze);
      new THREE.TextureLoader().load(host.kitUrl + 'ceu/ceu_fundo.jpg', t => {
        t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
        scene.background = t; scene.backgroundIntensity = info.bgScale; invalidate();
      });
      new RGBELoader().load(host.kitUrl + 'ceu/ceu_env.hdr', t => {
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromEquirectangular(t).texture; pm.dispose(); envHdr = t; host.changed(); // the path tracer needs the equirect
      });
      host.changed();
    }).catch(e => console.warn('Céu não carregou', e));
  } else {
    scene.background = new THREE.Color(css('--paper'));
    scene.fog = new THREE.Fog(css('--paper'), 60, 140);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xeaf2fb, 0x0c2f52, 0.45 * Math.PI));
  }
  const grp = new THREE.Group(); scene.add(grp);

  // ---------- materials ----------
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbcd3e2, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.42, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02 });
  if (fx.on) {
    // Glass without a transmission pass: dark tint + the sky's reflection added on top of what is behind it.
    // out = reflection + behind × (1 − opacity): premultiplied-style blending, one render of the scene only.
    Object.assign(glass, { color: new THREE.Color(0x0e1a1f), metalness: 0, roughness: 0.02, opacity: 0.32, envMapIntensity: 1.4, clearcoat: 0, depthWrite: false });
    Object.assign(glass, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  }
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.5, metalness: 0.6 }),
    glass,
    shadow: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    cap: new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.5, metalness: 0.4 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.95 }),
    plinth: new THREE.MeshStandardMaterial({ color: fx.sky ? 0x6f6c66 : 0x1c2530, roughness: 1 }),
    plaster: withModuleAO(new THREE.MeshStandardMaterial({ color: 0xefebe4, roughness: 0.95, envMapIntensity: fx.on ? 0.45 : 1 }), 'int'),
    floor: withModuleAO(new THREE.MeshStandardMaterial({ color: 0x9a6b43, roughness: 0.55, envMapIntensity: fx.on ? 0.45 : 1 }), 'int'),
    ceil: withModuleAO(new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: fx.on ? 0.45 : 1 }), 'int'),
    deckSide: new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.9 }),
    clad: withModuleAO(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), 'ext'),
    deck: new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 0.82 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.8 }),
  };
  if (!fx.contact) for (const k of ['plaster', 'floor', 'ceil', 'clad'] as const) { M[k].onBeforeCompile = () => {}; M[k].customProgramCacheKey = () => 'plain'; }
  const ceilings = new Map<string, THREE.MeshStandardMaterial>();
  const ceilingFor = (m: Mod) => {
    const cat = TYPES[m.type].cat; let c = ceilings.get(cat);
    if (!c) {
      c = M.ceil.clone(); c.onBeforeCompile = M.ceil.onBeforeCompile; c.customProgramCacheKey = M.ceil.customProgramCacheKey;
      const [col, k] = GLOW[cat] ?? [0xffe2c0, 0.6];
      if (fx.on) { c.emissive.set(col); c.emissiveIntensity = k; }
      ceilings.set(cat, c);
    }
    return c;
  };

  // ---------- Blender kit + textures ----------
  const units: Record<string, THREE.Object3D> = {};
  const facades: Partial<Record<Finish, Promise<Partial<THREE.MeshStandardMaterial>>>> = {};
  const facade = (f: Finish) => {
    const { size, normal } = FACADE[f], r = 1 / size;
    return (facades[f] ??= Promise.all([ktxTex(`fachada/${f}_cor.ktx2`, true, r, r), ktxTex(`fachada/${f}_nor.ktx2`, false, r, r), ktxTex(`fachada/${f}_arm.ktx2`, false, r, r)])
      .then(([c, n, arm]) => ({ map: c, normalMap: n, normalScale: new THREE.Vector2(normal, normal), aoMap: arm, roughnessMap: arm })));
  };
  let finishWanted: Finish = 'branco';
  const applyFinish = (f: Finish) => {
    finishWanted = f;
    facade(f).then(p => { if (finishWanted !== f) return; Object.assign(M.clad, p); M.clad.needsUpdate = true; host.changed(); }).catch(e => console.warn('Fachada não carregou', e));
  };
  applyFinish('branco');
  // flat surfaces with real material scans (Poly Haven, CC0): roof membrane, floor, footings, pergola timber.
  // [material, metres per texture tile, colour multiplier keeping the old average colour]
  if (fx.on) {
    const SURF: [string, THREE.MeshStandardMaterial, number, number][] = [
      ['cobertura', M.roof, 3, 0xaebccf], ['piso', M.floor, 1.6, 0xffffff], ['plinto', M.plinth, 2.5, 0xf2f2f2], ['pergola', M.timber, 1.5, 0xffd1a8]];
    for (const [k, mat, size, tint] of SURF) {
      const r = 1 / size;
      void Promise.all([ktxTex(`superficies/${k}_cor.ktx2`, true, r, r), ktxTex(`superficies/${k}_nor.ktx2`, false, r, r), ktxTex(`superficies/${k}_arm.ktx2`, false, r, r)]).then(([c, n, arm]) => {
        Object.assign(mat, { map: c, normalMap: n, roughnessMap: arm, aoMap: arm, roughness: 1, color: new THREE.Color(tint) }); mat.needsUpdate = true; host.changed();
      }).catch(e => console.warn(`Textura ${k} não carregou`, e));
    }
  }
  void Promise.all([ktxTex('deck_cor.ktx2', true, 1, 1), ktxTex('deck_normal.ktx2', false, 1, 1), ktxTex('deck_ao.ktx2', false, 1, 1)]).then(([c, n, ao]) => {
    Object.assign(M.deck, { map: c, normalMap: n, aoMap: ao, color: new THREE.Color(0xffffff) }); M.deck.needsUpdate = true; host.changed();
  }).catch(e => console.warn('Deck não carregou', e));
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(host.kitUrl + 'kit.glb', g => {
    for (const o of g.scene.children) {
      units[o.name] = o;
      o.traverse(n => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) { mesh.castShadow = true; if (fx.on && /vidro/.test((mesh.material as THREE.Material).name)) { mesh.material = M.glass; mesh.castShadow = false; } }
        n.raycast = () => {};
      });
    }
    if (units.G_180) units.G_090 = singleGlassDoor(units.G_180);
    host.changed();
  }, undefined, err => console.warn('Kit 3D não carregou', err));

  // ---------- Blender web kit (jular-treehouses blender/kit_web.py): furniture per room sketch and interior doors ----------
  // Same pieces as the Cycles renders of the house. Each furniture set has its origin at the centre of the unrotated
  // module, on the finished floor; materials by name from materiais.json (real textures in the desktop tier only).
  const furn: Partial<Record<string, THREE.Object3D>> = {};
  if (fx.furniture) {
    type KitMat = { color: [number, number, number]; roughness: number; metalness: number; transparent?: boolean; maps?: Partial<Record<'color' | 'normal' | 'arm', string>> };
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    void fetch(host.kitUrl + 'mobilia/materiais.json').then(r => r.json()).then((spec: Record<string, KitMat | string>) => {
      const mats = new Map<string, THREE.Material>();
      const matFor = (name: string): THREE.Material => {
        let m = mats.get(name);
        if (m) return m;
        const s = spec[name];
        if (typeof s !== 'object') m = M.plaster;
        else if (s.transparent || /vidro/.test(name)) m = M.glass;
        else {
          const mm = new THREE.MeshStandardMaterial({ name, color: new THREE.Color().setRGB(...s.color), roughness: s.roughness, metalness: s.metalness, envMapIntensity: fx.sky ? 0.6 : 1 });
          if (name === 'led') { mm.emissive.setRGB(...s.color); mm.emissiveIntensity = 1.2; }
          // the KTX2 files are flipped like JPGs for TextureLoader; glTF UVs are not, so repeat -1 in v undoes it
          if (s.maps && fx.tier === 'alto') for (const [k, f] of Object.entries(s.maps)) {
            void ktxTex(f, k === 'color', 1, -1).then(t => {
              if (k === 'color') mm.map = t; else if (k === 'normal') mm.normalMap = t; else { mm.roughnessMap = t; mm.aoMap = t; mm.roughness = 1; }
              mm.needsUpdate = true; invalidate();
            }).catch(e => console.warn(`Textura ${f} não carregou`, e));
          }
          m = mm;
        }
        mats.set(name, m); return m;
      };
      const load = (f: string, done: (o: THREE.Object3D) => void) => loader.load(host.kitUrl + `mobilia/${f}.glb`, g => {
        const o = g.scene.children[0] ?? g.scene;
        o.traverse(n => {
          const mesh = n as THREE.Mesh;
          if (mesh.isMesh) { const old = mesh.material as THREE.Material; mesh.material = matFor(old.name); old.dispose(); mesh.castShadow = mesh.material !== M.glass; mesh.receiveShadow = true; }
          n.raycast = () => {};
        });
        o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); done(o); host.changed();
      }, undefined, e => console.warn(`Peça ${f} não carregou`, e));
      for (const k of Object.keys(FURN)) load(`mob_${k}`, o => { furn[k] = o; });
      load('porta_interior', o => { units.porta_int = o; });
    }).catch(e => console.warn('Mobília não carregou', e));
  }

  /** Single-leaf glass door, 0.9 m, built in the same frame position and materials as the 1.8 m kit door. */
  function singleGlassDoor(ref: THREE.Object3D): THREE.Object3D {
    const c = ref.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(c), z = (bb.min.z + bb.max.z) / 2, y0 = bb.min.y, H = bb.max.y - bb.min.y;
    let frame: THREE.Material | undefined, gl: THREE.Material | undefined;
    c.traverse(n => { const m = (n as THREE.Mesh).material as THREE.Material | undefined; if (!m) return; if (m === M.glass || /vidro/.test(m.name)) gl = m; else if (/alu/.test(m.name)) frame = m; });
    frame ??= M.frame; gl ??= M.glass;
    const g = new THREE.Group(), W = 0.9, F = 0.06, D = 0.07;
    boxAt(F, H, D, frame, -W / 2 + F / 2, y0 + H / 2, z, g, 0.004); boxAt(F, H, D, frame, W / 2 - F / 2, y0 + H / 2, z, g, 0.004);
    boxAt(W, F, D, frame, 0, y0 + H - F / 2, z, g, 0.004); boxAt(W, F, D, frame, 0, y0 + F / 2, z, g, 0.004);
    boxAt(W - 2 * F, H - 2 * F, 0.012, gl, 0, y0 + H / 2, z, g);
    boxAt(0.02, 0.5, 0.03, frame, W / 2 - F - 0.06, y0 + 1.05, z + D / 2 + 0.01, g, 0.006);
    g.traverse(n => { if ((n as THREE.Mesh).isMesh && (n as THREE.Mesh).material !== gl) n.castShadow = true; });
    return g;
  }

  // ---------- modules ----------
  // one wall: local x along the wall, y up, outer face at z=0, inside towards -z
  type Hole = { x: number; y: number; w: number; h: number; u?: string };
  /** inset = how far the room's inner corners are from the wall ends; outside = the reveals are lined in the facade wood */
  function wall(L: number, holes: Hole[], inset: number, outside: boolean): THREE.Group {
    const g = new THREE.Group();
    const mk = (depth: number, z: number, mats: THREE.Material[]) => {
      const s = new THREE.Shape(); s.moveTo(-L / 2, 0); s.lineTo(L / 2, 0); s.lineTo(L / 2, WH); s.lineTo(-L / 2, WH); s.closePath();
      for (const h of holes) {
        const p = new THREE.Path(), x0 = Math.max(-L / 2 + 0.05, h.x - h.w / 2), x1 = Math.min(L / 2 - 0.05, h.x + h.w / 2);
        p.moveTo(x0, h.y); p.lineTo(x0, h.y + h.h); p.lineTo(x1, h.y + h.h); p.lineTo(x1, h.y); p.closePath(); s.holes.push(p);
      }
      const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      const side = geo.groups[1]; // ExtrudeGeometry: group 0 = front/back caps, group 1 = sides (wall ends, top, reveals)
      setAO(geo, (x, y, _z, i) => [y, x + L / 2 - inset, L / 2 - inset - x, side && i >= side.start && i < side.start + side.count ? 1 : 0]);
      const m = new THREE.Mesh(geo, mats); m.position.z = z; m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    mk(0.04, -0.04, [M.clad, M.clad]); mk(T - 0.04, -T, [M.plaster, fx.on && outside ? M.clad : M.plaster]);
    return g;
  }
  /** horizontal plane with in-module AO towards its four edges (floor, ceiling) */
  function roomPlane(w: number, d: number, mat: THREE.Material, h: number): THREE.Mesh {
    const g = meterUV(new THREE.PlaneGeometry(w, d, 12, 12));
    setAO(g, (x, y) => [h, Math.min(x + w / 2, w / 2 - x), Math.min(y + d / 2, d / 2 - y), 0]);
    return new THREE.Mesh(g, mat);
  }
  const cladBox = (w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const m = boxAt(w, h, d, M.clad, x, y, z, parent, 0.012);
    setAO(m.geometry, (_x, py) => [py + h / 2, 9, 9, 0]);
    m.castShadow = m.receiveShadow = true; return m;
  };

  function roomModule(mods: Mod[], m: Mod, ds: Door[]): THREE.Group {
    const f = fp(m), w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2;
    type Wall = { c: [number, number]; n: [number, number]; L: number; H: Hole[]; inset: number };
    const S: Record<'N' | 'S' | 'W' | 'E', Wall> = {
      N: { c: [cx, f.y / 10], n: [0, -1], L: w, H: [], inset: T }, S: { c: [cx, f.y / 10 + d], n: [0, 1], L: w, H: [], inset: T },
      W: { c: [f.x / 10, cz], n: [-1, 0], L: d - 2 * T, H: [], inset: 0 }, E: { c: [f.x / 10 + w, cz], n: [1, 0], L: d - 2 * T, H: [], inset: 0 },
    };
    const local = (k: keyof typeof S, X: number, Z: number) => { const s = S[k], r = Math.atan2(s.n[0], s.n[1]); return (X - s.c[0]) * Math.cos(r) - (Z - s.c[1]) * Math.sin(r); };
    // shared walls: doors, open plan, glass doors and windows towards a deck
    for (const dd of ds) {
      if ((dd.a !== m && dd.b !== m) || dd.kind === 'parede') continue;
      const k: keyof typeof S = dd.vertical ? (Math.abs(dd.x - f.x) < 0.5 ? 'W' : 'E') : (Math.abs(dd.y - f.y) < 0.5 ? 'N' : 'S');
      const off = local(k, dd.x / 10, dd.y / 10), o = OPENINGS[dd.kind];
      if (dd.kind === 'aberto') S[k].H.push({ x: off, y: 0, w: dd.len / 10 - 0.3, h: WH - FL - ROOFT - 0.05 });
      // interior door: frame and leaf from the web kit, in one of the two walls only
      else S[k].H.push({ u: dd.kind === 'porta' ? (dd.a === m ? 'porta_int' : undefined) : pieceOf(dd.kind, dd.len), x: off, y: o.sill, w: widthOf(dd.kind, dd.len), h: o.h });
    }
    // outside walls: windows, glass doors and the front door, as chosen or by default
    for (const ow of outWalls(mods, m)) {
      if (ow.kind === 'parede') continue;
      const o = OPENINGS[ow.kind];
      S[ow.side].H.push({ u: pieceOf(ow.kind, ow.len), x: 0, y: o.sill, w: widthOf(ow.kind, ow.len), h: o.h });
    }
    const sd = sides(mods, m);
    const g = new THREE.Group();
    for (const [k, s] of Object.entries(S) as [keyof typeof S, Wall][]) {
      g.add(placeAt(wall(s.L, s.H.map(h => ({ x: h.x, y: FL + h.y, w: h.w, h: h.h })), s.inset, sd[k] !== 'room'), s.c[0], y0, s.c[1], s.n[0], s.n[1], 0));
      for (const h of s.H) if (h.u && units[h.u]) g.add(placeAt(units[h.u].clone(true), s.c[0], y0 + FL + h.y, s.c[1], s.n[0], s.n[1], h.x));
    }
    // corner posts clad in the facade wood hide the wall ends (the catalogue houses have no coloured corner trims)
    for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cladBox(T + 0.03, WH, T + 0.03, f.x / 10 + sx * w + (sx ? -T / 2 + 0.015 : T / 2 - 0.015), y0 + WH / 2, f.y / 10 + sz * d + (sz ? -T / 2 + 0.015 : T / 2 - 0.015), g);
    const fl = roomPlane(w - 2 * T, d - 2 * T, M.floor, FL + 1.2); fl.rotation.x = -Math.PI / 2; fl.position.set(cx, y0 + FL, cz); fl.receiveShadow = true; g.add(fl);
    const ce = roomPlane(w - 2 * T, d - 2 * T, ceilingFor(m), FL + 1.2); ce.rotation.x = Math.PI / 2; ce.position.set(cx, y0 + WH - ROOFT, cz); g.add(ce);
    const rf = boxAt(w - 2 * T, ROOFT - 0.02, d - 2 * T, M.roof, cx, y0 + WH - ROOFT / 2 - 0.01, cz, g); rf.castShadow = true;
    // furniture of the room's sketch, centred, turned with the module (rot is clockwise on the plan); skipped when it does not fit
    const t = TYPES[m.type], set = t.sketch ? furn[t.sketch] : undefined;
    if (set && t.w / 10 >= FURN[t.sketch!][0] - 0.01 && t.h / 10 >= FURN[t.sketch!][1] - 0.01) {
      const o = set.clone(true); o.rotation.y = -m.rot * Math.PI / 180; o.position.set(cx, y0 + FL, cz); g.add(o);
    }
    return noRay(g);
  }

  /** Timber pergola over a deck: posts on the corners away from the house, edge beams and slats at roof height. */
  function pergola(mods: Mod[], m: Mod, g: THREE.Group): void {
    const f = fp(m), w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, x0 = f.x / 10, z0 = f.y / 10, sd = sides(mods, m);
    const top = y0 + WH - 0.12, P = 0.12, B = 0.08, r = fx.on ? 0.008 : 0;
    const open = { N: sd.N !== 'room', S: sd.S !== 'room', W: sd.W !== 'room', E: sd.E !== 'room' };
    for (const [cx, cz, a, b] of [[x0, z0, 'N', 'W'], [x0 + w, z0, 'N', 'E'], [x0, z0 + d, 'S', 'W'], [x0 + w, z0 + d, 'S', 'E']] as const)
      if (open[a] || open[b]) boxAt(P, WH - 0.12, P, M.timber, cx + (cx === x0 ? P / 2 : -P / 2), y0 + (WH - 0.12) / 2, cz + (cz === z0 ? P / 2 : -P / 2), g, r).castShadow = true;
    const along = w >= d; // slats run across the shorter side
    const L = along ? w : d, S = along ? d : w;
    for (const e of [0, 1]) { // two edge beams along the long side
      const bm = along ? boxAt(w, 0.2, B, M.timber, x0 + w / 2, top, z0 + (e ? d - B / 2 : B / 2), g, r) : boxAt(B, 0.2, d, M.timber, x0 + (e ? w - B / 2 : B / 2), top, z0 + d / 2, g, r);
      bm.castShadow = true;
    }
    const n = Math.max(2, Math.round(L / 0.45));
    for (let i = 0; i <= n; i++) {
      const t = 0.04 + (L - 0.08) * i / n;
      const sl = along ? boxAt(0.05, 0.16, S, M.timber, x0 + t, top + 0.12, z0 + d / 2, g, r) : boxAt(S, 0.16, 0.05, M.timber, x0 + w / 2, top + 0.12, z0 + t, g, r);
      sl.castShadow = true;
    }
  }

  function deckModule(mods: Mod[], m: Mod): THREE.Group {
    const f = fp(m), w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2, g = new THREE.Group();
    const top = new THREE.PlaneGeometry(w, d), uv = top.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 1.12, uv.getY(i) * d / 1.12);
    const t = new THREE.Mesh(top, M.deck); t.rotation.x = -Math.PI / 2; t.position.set(cx, y0 + 0.001, cz); t.receiveShadow = true; g.add(t);
    const b = boxAt(w, 0.14, d, M.deckSide, cx, y0 - 0.07, cz, g, fx.on ? 0.01 : 0); b.castShadow = true; b.receiveShadow = true;
    if (!lv(m)) boxAt(w - 0.3, BASE - 0.14, d - 0.3, M.plinth, cx, (BASE - 0.14) / 2, cz, g).receiveShadow = true;
    else { // terrace on an upper floor: glass guard rail on the open edges
      const sd = sides(mods, m);
      for (const [k, x, z, lw, ld] of [['N', cx, cz - d / 2 + 0.03, w, 0.04], ['S', cx, cz + d / 2 - 0.03, w, 0.04], ['W', cx - w / 2 + 0.03, cz, 0.04, d], ['E', cx + w / 2 - 0.03, cz, 0.04, d]] as const) {
        if (sd[k] === 'room') continue;
        boxAt(lw, 0.9, ld, M.glass, x, y0 + 0.45, z, g); boxAt(lw + 0.02, 0.05, ld + 0.04, M.frame, x, y0 + 0.93, z, g, fx.on ? 0.01 : 0);
      }
    }
    if (TYPES[m.type]?.pergola) pergola(mods, m, g);
    return noRay(g);
  }

  // ---------- contact shadows (layer 4): ground under the house, decks next to rooms ----------
  const contactMats: THREE.Material[] = [];
  function contact(mods: Mod[]): void {
    for (const m of contactMats) { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); }
    contactMats.length = 0;
    if (!fx.contact || !mods.length) return;
    const overlay = (tex: THREE.Texture, x0: number, z0: number, x1: number, z1: number, y: number, uv: [number, number, number, number]) => {
      const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0), a = geo.attributes.uv;
      // plane UV (0,0) = (x0, z1) after the -90° rotation; map into the contact texture's window
      for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const p = new THREE.Mesh(geo, mat); p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); p.renderOrder = 1;
      contactMats.push(mat); p.userData.rasterOnly = true; grp.add(noRay(p));
    };
    for (let L = 0; L <= MAX_LEVEL; L++) {
      const here = mods.filter(m => lv(m) === L); if (!here.length) continue;
      const decks = here.filter(m => TYPES[m.type].kind === 'deck'), rooms = here.filter(m => TYPES[m.type].kind === 'room');
      if (L === 0) { // the whole ground floor on the grass
        const c = paintContact(here.map(fp), { margin: 3.5, blur: 0.55, strength: 0.6, grow: 0.12 });
        overlay(c.texture, c.x0, c.z0, c.x1, c.z1, 0.012, [0, 0, 1, 1]);
      }
      if (decks.length && rooms.length) { // rooms on the decks around them
        const c = paintContact(rooms.map(fp), { margin: 1.5, blur: 0.35, strength: 0.45, grow: 0 });
        for (const dk of decks) {
          const r = fp(dk), x0 = r.x / 10, z0 = r.y / 10, x1 = x0 + r.w / 10, z1 = z0 + r.h / 10;
          overlay(c.texture, x0, z0, x1, z1, BASE + L * WH + 0.004, [(x0 - c.x0) / (c.x1 - c.x0), 1 - (z1 - c.z0) / (c.z1 - c.z0), (x1 - c.x0) / (c.x1 - c.x0), 1 - (z0 - c.z0) / (c.z1 - c.z0)]);
        }
      }
    }
  }

  // ---------- trees (desktop tier): impostors of Poly Haven trees (CC0) rendered in Cycles, 8 azimuths x 2 elevations ----------
  interface Impostor { cols: number; azimuths: number; elevations_deg: number[]; size_m: number; center_m: number }
  const TREES = ['island_tree_01', 'island_tree_02', 'tree_small_02', 'jacaranda_tree'];
  const trees: { mesh: THREE.Mesh; info: Impostor; yaw: number }[] = [];
  const treeGrp = new THREE.Group(); scene.add(treeGrp);
  let treeKinds: { mat: THREE.MeshStandardMaterial; info: Impostor }[] | null = null, treeCentre: THREE.Vector3 | null = null, treeR = 0;
  if (fx.trees) {
    void Promise.all(TREES.map(id => Promise.all([fetch(host.kitUrl + `arvores/${id}.json`).then(r => r.json() as Promise<Impostor>), ktxTex(`arvores/${id}_cor.ktx2`, true, 1, 1)])
      .then(([info, map]) => {
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; map.repeat.set(1, 1); map.anisotropy = 1;
        const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide, envMapIntensity: 0.8 });
        Object.assign(mat, { castShadow: false }); // read by the path tracer: a card turned to the camera would cast a sliver
        return { info, mat };
      }))).then(k => { treeKinds = k; placeTrees(); }).catch(e => console.warn('Árvores não carregaram', e));
  }
  /** a loose ring of trees around the house, re-planted only when the house grows into it */
  function placeTrees(): void {
    if (!treeKinds || !treeCentre) return;
    for (const o of treeGrp.children) (o as THREE.Mesh).geometry.dispose();
    trees.length = 0; treeGrp.clear();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // [angle around the house, distance factor, kind]: more of them behind the house, as seen from the default camera
    const spots: [number, number, number][] = [[0.2, 0.6, 0], [0.9, 1.4, 2], [1.6, 0.3, 1], [2.2, 0.9, 0], [2.7, 0.2, 2], [3.2, 1.2, 1], [3.6, 0.5, 0], [4.1, 0.1, 1], [4.6, 0.8, 2], [5.3, 0.4, 0], [5.9, 2.2, 3]];
    for (const [a, k, kind] of spots) {
      const { info, mat } = treeKinds[kind], d = treeR + 4 + k * 8 + rnd() * 3, ang = a + rnd() * 0.35, sc = 0.85 + rnd() * 0.3;
      const g = new THREE.PlaneGeometry(info.size_m * sc, info.size_m * sc);
      const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.6, 0.8); // lit like a rounded crown, not a flat card
      const mesh = new THREE.Mesh(g, mat); mesh.position.set(treeCentre.x + Math.cos(ang) * d, info.center_m * sc, treeCentre.z + Math.sin(ang) * d);
      mesh.receiveShadow = true; treeGrp.add(noRay(mesh)); trees.push({ mesh, info, yaw: rnd() * Math.PI * 2 });
      const r = info.size_m * sc * 0.42, sh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), M.shadow); // soft shade under the crown
      sh.rotation.x = -Math.PI / 2; sh.position.set(mesh.position.x, 0.015, mesh.position.z); sh.userData.rasterOnly = true; treeGrp.add(noRay(sh));
    }
    faceTrees();
  }
  /** turn each card to the camera and show the view of the tree rendered closest to this direction */
  function faceTrees(): void {
    for (const { mesh, info, yaw } of trees) {
      const dx = cam.position.x - mesh.position.x, dz = cam.position.z - mesh.position.z, dy = cam.position.y - mesh.position.y;
      mesh.rotation.y = Math.atan2(dx, dz);
      const az = Math.atan2(-dz, dx) - yaw; // Blender azimuth: from +x towards +y (= three -z)
      const col = ((Math.round(az / (2 * Math.PI / info.azimuths)) % info.azimuths) + info.azimuths) % info.azimuths;
      const el = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, E = info.elevations_deg;
      const row = el > (E[0] + E[1]) / 2 ? 1 : 0, rows = E.length;
      const u0 = col / info.cols, u1 = (col + 1) / info.cols, v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
      const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); uv.needsUpdate = true;
    }
  }

  // ---------- build ----------
  let pickers: THREE.Mesh[] = [];
  function build(mods: Mod[], sel: Mod | null, bad: Set<Mod>, ds: Door[]): void {
    for (const o of [...grp.children]) { grp.remove(o); o.traverse(n => (n as THREE.Mesh).geometry?.dispose()); }
    pickers = [];
    if (mods.length) {
      const fs = mods.map(fp);
      const x0 = Math.min(...fs.map(f => f.x)) / 10, x1 = Math.max(...fs.map(f => f.x + f.w)) / 10, z0 = Math.min(...fs.map(f => f.y)) / 10, z1 = Math.max(...fs.map(f => f.y + f.h)) / 10;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rad = Math.hypot(x1 - x0, z1 - z0) / 2 + WH * (MAX_LEVEL + 1) + 2;
      sun.target.position.set(cx, 0, cz); sun.position.set(cx + sunDir.x * 60, sunDir.y * 60, cz + sunDir.z * 60);
      if (fx.on) Object.assign(sun.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 60 - rad - 5, far: 60 + rad + 5 }); // shadow box fitted to the house
      sun.shadow.camera.updateProjectionMatrix();
      const r0 = Math.hypot(x1 - x0, z1 - z0) / 2;
      if (!treeCentre || treeCentre.distanceTo(new THREE.Vector3(cx, 0, cz)) + r0 > treeR + 4) { treeCentre = new THREE.Vector3(cx, 0, cz); treeR = r0; placeTrees(); }
    }
    const covered = (m: Mod) => mods.some(o => lv(o) === lv(m) + 1 && overlaps(fp(o), fp(m)));
    for (const m of mods) {
      const deck = TYPES[m.type].kind === 'deck', f = fp(m);
      const w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2, hh = deck ? 0.14 : WH;
      grp.add(deck ? deckModule(mods, m) : roomModule(mods, m, ds));
      if (!deck && !covered(m)) noRay(boxAt(w + 0.04, 0.14, d + 0.04, M.cap, cx, y0 + hh + 0.05, cz, grp, fx.on ? 0.012 : 0)).castShadow = true; // roof flashing
      if (!deck && !lv(m)) {
        noRay(boxAt(w - 0.3, BASE, d - 0.3, M.plinth, cx, BASE / 2, cz, grp));
        if (!fx.contact) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.6, d + 1.6), M.shadow); sh.userData.rasterOnly = true; sh.rotation.x = -Math.PI / 2; sh.position.set(cx, 0.02, cz); grp.add(noRay(sh)); }
      }
      // invisible box used for picking and for stacking
      const pick = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d)); pick.visible = false; pick.position.set(cx, deck ? y0 - 0.07 : y0 + hh / 2, cz);
      pick.userData.m = m; grp.add(pick); pickers.push(pick);
      if (m === sel || bad.has(m)) {
        const halo = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.1, hh + 0.1, d + 0.1)), new THREE.LineBasicMaterial({ color: bad.has(m) ? 0xff8a7a : 0xe3b277 }));
        halo.position.copy(pick.position); grp.add(noRay(halo));
      }
    }
    contact(mods);
    invalidate();
  }

  // ---------- camera ----------
  function setRenderSize(w: number, h: number): void {
    renderer.setSize(w, h, false); post.setSize(w, h); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); invalidate();
  }
  function resize(): void { const r = box.parentElement!.getBoundingClientRect(); setRenderSize(r.width, r.height); }
  function frame(mods: Mod[]): void {
    if (!mods.length) { cam.position.set(18, 16, 22); controls.target.set(0, 0, 0); controls.update(); invalidate(); return; }
    const fs = mods.map(fp);
    const x0 = Math.min(...fs.map(f => f.x)) / 10, z0 = Math.min(...fs.map(f => f.y)) / 10, x1 = Math.max(...fs.map(f => f.x + f.w)) / 10, z1 = Math.max(...fs.map(f => f.y + f.h)) / 10;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0, 8);
    controls.target.set(cx + span * 0.12, 1.5, cz); cam.position.set(cx + span * 1.3, span * 0.75, cz + span * 1.65); controls.update(); invalidate();
  }
  function dolly(k: number): void { const v = cam.position.clone().sub(controls.target).multiplyScalar(k); cam.position.copy(controls.target).add(v); controls.update(); invalidate(); }
  controls.addEventListener('change', () => { invalidate(); host.selectionMoved(); });

  // ---------- drag and stack ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag: { m: Mod; moved: boolean; side?: 'N' | 'S' | 'W' | 'E'; at?: THREE.Vector3 } | null = null;
  let press: { x: number; y: number } | null = null;
  const showGrid = (on: boolean) => { if (fx.sky && grid.visible !== on) { grid.visible = on; invalidate(); } };
  const aim = (x: number, y: number) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, cam); };
  function place(m: Mod, x: number, y: number): void {
    aim(x, y); showGrid(true);
    let pt: THREE.Vector3 | null = null, z = 0;
    const hit = ray.intersectObjects(pickers.filter(o => o.userData.m !== m))[0];
    if (hit) { const o = hit.object.userData.m as Mod; if (TYPES[o.type].kind === 'room' && hit.face && hit.face.normal.y > 0.5 && lv(o) < MAX_LEVEL) { pt = hit.point; z = lv(o) + 1; } }
    if (!pt) { pt = new THREE.Vector3(); if (!ray.ray.intersectPlane(groundPlane, pt)) return; z = 0; }
    m.z = z; const f = fp(m); m.x = Math.round(pt.x * 10 - f.w / 2); m.y = Math.round(pt.z * 10 - f.h / 2); host.snap(m); host.changed();
  }
  box.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    aim(e.clientX, e.clientY); press = { x: e.clientX, y: e.clientY };
    const hit = ray.intersectObjects(pickers)[0];
    if (hit) {
      const m = hit.object.userData.m as Mod, n = hit.face?.normal; // pick boxes are not rotated: local normal = world normal
      const side = !n || Math.abs(n.y) > 0.5 ? undefined : Math.abs(n.x) > 0.5 ? (n.x > 0 ? 'E' : 'W') : (n.z > 0 ? 'S' : 'N');
      host.select(m); drag = { m, moved: false, side, at: hit.point.clone() }; controls.enabled = false; box.setPointerCapture(e.pointerId); host.changed(); }
  }, true);
  box.addEventListener('pointermove', e => {
    if (!drag || !press) return;
    if (!drag.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    drag.moved = true; place(drag.m, e.clientX, e.clientY);
  });
  const up = (e: PointerEvent) => {
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) { host.select(null); host.changed(); }
    if (drag) {
      const d = drag; drag = null; showGrid(false); host.changed();
      // a click on a wall (no drag) opens the wall menu
      if (!d.moved && d.side && d.at && e.type === 'pointerup' && TYPES[d.m.type].kind === 'room') host.wallClick(d.m, d.side, d.at.x * 10, d.at.z * 10, e.clientX, e.clientY);
    }
    controls.enabled = true; press = null;
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);

  // render only when something changed (camera, plan, a texture arriving): no work and no battery while still
  let loop = 0, last = 0, rendered = false;
  const tick = (now: number) => {
    const moved = controls.update();
    if (moved || dirty) {
      dirty = false; if (trees.length) faceTrees(); post.render();
      if (rendered) post.watch(now - last, now);
      rendered = true; last = now;
    } else rendered = false;
    loop = requestAnimationFrame(tick);
  };

  return {
    build,
    screenOf(m, rect) {
      const f = fp(m);
      const v = new THREE.Vector3((f.x + f.w / 2) / 10, BASE + lv(m) * WH + (TYPES[m.type].kind === 'deck' ? 0 : WH), (f.y + f.h / 2) / 10).project(cam);
      return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
    },
    dolly,
    startDrag(m) { drag = { m, moved: true }; },
    place,
    endDrag() { drag = null; showGrid(false); },
    dragging: () => !!drag,
    frame,
    resize,
    start() { cancelAnimationFrame(loop); invalidate(); loop = requestAnimationFrame(tick); },
    stop() { cancelAnimationFrame(loop); },
    setFinish(f) { applyFinish(f); },
    canPhoto: () => !!envHdr,
    async photo(mods, ds, o) {
      if (!envHdr) return null;
      cancelAnimationFrame(loop);
      // the path tracer computes real shadows, bounce light and glass: the raster-only helpers come out
      build(mods, null, new Set(), ds);
      const hidden: THREE.Object3D[] = [];
      scene.traverse(n => { if (n.userData.rasterOnly && n.visible) { n.visible = false; hidden.push(n); } });
      const gridOn = grid.visible; grid.visible = false;
      // The path tracer reads raw float vertex data: the kit's meshopt-quantized (normalized, interleaved) attributes are
      // unpacked to plain floats for the photo, and tangents added (three r160 computes them only for indexed geometry).
      const swapped: [THREE.Mesh, THREE.BufferGeometry][] = [];
      grp.traverse(n => {
        const mesh = n as THREE.Mesh, geo = mesh.geometry as THREE.BufferGeometry | undefined;
        if (!mesh.isMesh || !geo) return;
        let g = geo;
        const packed = Object.values(geo.attributes).some(a => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array));
        if (packed) {
          g = new THREE.BufferGeometry(); g.index = geo.index; g.groups = geo.groups;
          for (const [k, a] of Object.entries(geo.attributes)) {
            const out = new Float32Array(a.count * a.itemSize);
            const get = [a.getX, a.getY, a.getZ, a.getW];
            for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = get[c].call(a, i);
            g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
          }
        }
        if (!g.attributes.tangent && g.attributes.uv && g.attributes.normal) {
          if (g === geo) g = geo.clone();
          if (g.index) g.computeTangents();
          else { g.setIndex([...Array(g.attributes.position.count).keys()]); g.computeTangents(); g.setIndex(null); }
        }
        if (g !== geo) { swapped.push([mesh, geo]); mesh.geometry = g; }
      });
      // three-gpu-pathtracer 0.0.23 gives each mesh one material slot: multi-material meshes (walls) are split by group
      const split: THREE.Mesh[] = [], unsplit: THREE.Mesh[] = [];
      grp.traverse(n => { const mesh = n as THREE.Mesh; if (mesh.isMesh && mesh.visible && Array.isArray(mesh.material)) unsplit.push(mesh); });
      for (const mesh of unsplit) {
        const geo = mesh.geometry, mats = mesh.material as THREE.Material[];
        for (const gr of geo.groups) {
          const mat = mats[gr.materialIndex ?? 0]; if (!mat) continue;
          const sub = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(geo.attributes)) sub.setAttribute(k, a);
          const idx: number[] = [], end = gr.start + gr.count;
          for (let i = gr.start; i < end; i++) idx.push(geo.index ? geo.index.getX(i) : i);
          sub.setIndex(idx);
          const m = new THREE.Mesh(sub, mat); m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
          mesh.parent!.add(m); split.push(m);
        }
        mesh.visible = false;
      }
      const g = M.glass, keep = { color: g.color.clone(), opacity: g.opacity, transparent: g.transparent, blending: g.blending, roughness: g.roughness, metalness: g.metalness, transmission: g.transmission, ior: g.ior, depthWrite: g.depthWrite };
      Object.assign(g, { opacity: 1, transparent: false, blending: THREE.NormalBlending, roughness: 0, metalness: 0, transmission: 1, ior: 1.52, depthWrite: true });
      g.color.set(0xe9f1ef); // clear glass with a faint green edge tint
      const env = scene.environment, pr = renderer.getPixelRatio();
      scene.environment = envHdr;
      renderer.setPixelRatio(1); setRenderSize(o.width, o.height);
      try {
        const { pathTrace } = await import('../fx/photo');
        const r = await pathTrace(renderer, scene, cam, o, () => renderer.domElement.toDataURL('image/jpeg', 0.9));
        return r.result;
      } catch (e) { console.warn('Fotografia realista falhou', e); return null; }
      finally {
        for (const m of split) { m.removeFromParent(); m.geometry.dispose(); }
        for (const m of unsplit) m.visible = true;
        for (const [mesh, geo] of swapped) { mesh.geometry.dispose(); mesh.geometry = geo; }
        scene.environment = env; Object.assign(g, keep); g.needsUpdate = true;
        for (const n of hidden) n.visible = true;
        grid.visible = gridOn; renderer.setPixelRatio(pr); resize();
        host.changed(); loop = requestAnimationFrame(tick);
      }
    },
    capture(mods, bad, ds) {
      const p = cam.position.clone(), t = controls.target.clone();
      setRenderSize(960, 600); frame(mods); dolly(0.62);
      build(mods, null, bad, ds); post.render();
      const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
      cam.position.copy(p); controls.target.copy(t); controls.update(); resize();
      return url;
    },
  };
}

function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 23, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
