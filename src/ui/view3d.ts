// 3D view: blueprint ground, modules built from the Blender kit (public/kit), drag and stack in 3D.
// Units: plan is in dm, the scene in metres.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MAX_LEVEL, STOREY, TYPES, type Mod } from '../model/catalog';
import { footprint as fp, level as lv, overlaps, sides, type Door } from '../model/geometry';

export type Finish = 'branco' | 'madeira' | 'grafite';

export interface View3DHost {
  /** folder with kit.glb and the baked textures, ending in '/' */
  kitUrl: string;
  getMods(): Mod[];
  select(m: Mod | null): void;
  /** the plan or the selection changed: re-render everything */
  changed(): void;
  /** the camera moved: reposition the selection toolbar */
  selectionMoved(): void;
  snap(m: Mod): void;
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
}

const WH = STOREY / 10; // storey height, m
const BASE = 0.3; // modules sit on footings 30 cm above the ground
const T = 0.2; // wall thickness
const FL = 0.25; // floor build-up
const ROOFT = 0.3; // roof slab
/** Facade finishes: real wood scans (Poly Haven, CC0) in public/kit/fachada; size = metres covered by one texture tile. */
const FACADE: Record<Finish, { size: number; normal: number }> = { branco: { size: 1.8, normal: 0.8 }, madeira: { size: 1.13, normal: 1 }, grafite: { size: 1.6, normal: 1 } };

/** Kit pieces placed on free outside walls, per room type: [piece, sill height m]. Longest wall first. */
const UNIT: Partial<Record<Mod['type'], [string, number][]>> = {
  sala: [['W_sala', 0.2], ['W_sala2', 0.7]], cozinha: [['W_cozinha', 1.05]], entrada: [['D_entrada', 0], ['W_wc', 1.6]],
  quarto: [['W_quarto', 0.9]], suite: [['W_quarto', 0.9], ['W_wc', 1.6]], livre: [['W_livre', 0.8]], escada: [['W_escada', 0.4]],
};
/** Opening size of each kit piece, [width, height] m. */
const UW: Record<string, [number, number]> = {
  W_sala: [2.4, 2.2], W_sala2: [1.6, 1.6], W_quarto: [1.2, 1.2], W_cozinha: [1.4, 1.0], W_wc: [0.6, 0.6], W_escada: [0.5, 2.0],
  W_livre: [1.4, 1.4], D_entrada: [1.0, 2.2], G_240: [2.4, 2.3], G_180: [1.8, 2.3],
};

const noRay = <O extends THREE.Object3D>(o: O): O => { o.traverse(n => { n.raycast = () => {}; }); return o; };
const withUV2 = <G extends THREE.BufferGeometry>(g: G): G => { g.setAttribute('uv2', g.attributes.uv); return g; };
function boxAt(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m;
}
function placeAt<O extends THREE.Object3D>(obj: O, cx: number, y: number, cz: number, nx: number, nz: number, off: number): O {
  const r = Math.atan2(nx, nz); obj.rotation.y = r; obj.position.set(cx + Math.cos(r) * off, y, cz - Math.sin(r) * off); return obj;
}
function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 23, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

export function createView3D(box: HTMLElement, host: View3DHost): View3D | null {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch { return null; }
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  THREE.ColorManagement.legacyMode = false; // hex colours are sRGB
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  box.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(css('--paper'));
  scene.fog = new THREE.Fog(css('--paper'), 60, 140);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 5; controls.maxDistance = 90;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xeaf2fb, 0x0c2f52, 0.45));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  scene.add(sun, sun.target);
  // blueprint ground with the plan grid
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: css('--paper-deep'), roughness: 1, envMapIntensity: 0.15 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const [n, c1, c2, y] of [[200, 0x5f86ad, 0x2a5580, 0.005], [40, 0x8fb3d6, 0x8fb3d6, 0.01]] as const) {
    const g = new THREE.GridHelper(200, n, c1, c2); g.position.y = y; (g.material as THREE.Material).transparent = true; (g.material as THREE.Material).opacity = 0.35; scene.add(g);
  }
  const grp = new THREE.Group(); scene.add(grp);

  // ---------- materials ----------
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbcd3e2, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.42, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02 }),
    shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    cap: new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.5, metalness: 0.4 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.95 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 1 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xefebe4, roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x9a6b43, roughness: 0.55 }),
    ceil: new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.95, side: THREE.DoubleSide }),
    deckSide: new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.9 }),
    clad: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    deck: new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 0.82 }),
  };
  // ---------- Blender kit ----------
  const units: Record<string, THREE.Object3D> = {};
  const tl = new THREE.TextureLoader();
  const tex = (f: string, srgb: boolean, rx: number, ry: number) => {
    const t = tl.load(host.kitUrl + f, () => host.changed());
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
  };
  // wall UVs are in metres: one cladding tile = 1.2 m × 2.4 m; deck UVs are scaled to 1.12 m tiles
  const facades: Partial<Record<Finish, Partial<THREE.MeshStandardMaterial>>> = {};
  const facade = (f: Finish) => {
    const { size, normal } = FACADE[f], r = 1 / size, arm = tex(`fachada/${f}_arm.jpg`, false, r, r);
    return (facades[f] ??= { map: tex(`fachada/${f}_cor.jpg`, true, r, r), normalMap: tex(`fachada/${f}_nor.jpg`, false, r, r), normalScale: new THREE.Vector2(normal, normal), aoMap: arm, roughnessMap: arm });
  };
  Object.assign(M.clad, facade('branco'));
  Object.assign(M.deck, { map: tex('deck_cor.jpg', true, 1, 1), normalMap: tex('deck_normal.png', false, 1, 1), aoMap: tex('deck_ao.jpg', false, 1, 1) });
  new GLTFLoader().load(host.kitUrl + 'kit.glb', g => {
    for (const o of g.scene.children) { units[o.name] = o; o.traverse(n => { if ((n as THREE.Mesh).isMesh) n.castShadow = true; n.raycast = () => {}; }); }
    host.changed();
  }, undefined, err => console.warn('Kit 3D não carregou', err));

  // one wall: local x along the wall, y up, outer face at z=0, inside towards -z
  type Hole = { x: number; y: number; w: number; h: number; u?: string };
  function wall(L: number, holes: Hole[]): THREE.Group {
    const g = new THREE.Group();
    const mk = (depth: number, z: number, mat: THREE.Material) => {
      const s = new THREE.Shape(); s.moveTo(-L / 2, 0); s.lineTo(L / 2, 0); s.lineTo(L / 2, WH); s.lineTo(-L / 2, WH); s.closePath();
      for (const h of holes) {
        const p = new THREE.Path(), x0 = Math.max(-L / 2 + 0.05, h.x - h.w / 2), x1 = Math.min(L / 2 - 0.05, h.x + h.w / 2);
        p.moveTo(x0, h.y); p.lineTo(x0, h.y + h.h); p.lineTo(x1, h.y + h.h); p.lineTo(x1, h.y); p.closePath(); s.holes.push(p);
      }
      const m = new THREE.Mesh(withUV2(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })), mat);
      m.position.z = z; m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    mk(0.04, -0.04, M.clad); mk(T - 0.04, -T, M.plaster);
    return g;
  }

  function roomModule(mods: Mod[], m: Mod, ds: Door[]): THREE.Group {
    const f = fp(m), w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2, sd = sides(mods, m);
    type Wall = { c: [number, number]; n: [number, number]; L: number; H: Hole[] };
    const S: Record<'N' | 'S' | 'W' | 'E', Wall> = {
      N: { c: [cx, f.y / 10], n: [0, -1], L: w, H: [] }, S: { c: [cx, f.y / 10 + d], n: [0, 1], L: w, H: [] },
      W: { c: [f.x / 10, cz], n: [-1, 0], L: d - 2 * T, H: [] }, E: { c: [f.x / 10 + w, cz], n: [1, 0], L: d - 2 * T, H: [] },
    };
    const local = (k: keyof typeof S, X: number, Z: number) => { const s = S[k], r = Math.atan2(s.n[0], s.n[1]); return (X - s.c[0]) * Math.cos(r) - (Z - s.c[1]) * Math.sin(r); };
    // openings from the automatic door rules
    for (const dd of ds) {
      if (dd.a !== m && dd.b !== m) continue;
      const k: keyof typeof S = dd.vertical ? (Math.abs(dd.x - f.x) < 0.5 ? 'W' : 'E') : (Math.abs(dd.y - f.y) < 0.5 ? 'N' : 'S');
      const off = local(k, dd.x / 10, dd.y / 10);
      if (dd.glass) { const u = dd.len >= 29 ? 'G_240' : 'G_180'; S[k].H.push({ u, x: off, y: 0, w: UW[u][0], h: UW[u][1] }); }
      else if (dd.open) S[k].H.push({ x: off, y: 0, w: dd.len / 10 - 0.3, h: WH - FL - ROOFT - 0.05 });
      else S[k].H.push({ x: off, y: 0, w: 0.9, h: 2.1 });
    }
    // windows and the front door on free outside walls, longest wall first
    const free = (Object.keys(S) as (keyof typeof S)[]).filter(k => sd[k] === 'free').sort((a, b) => S[b].L - S[a].L);
    const spec = (UNIT[m.type] || UNIT.livre!).slice();
    if (m.type === 'entrada' && lv(m)) spec.shift(); // no front door upstairs
    free.forEach((k, i) => {
      const sp = spec[i]; if (!sp) return;
      const [u, sill] = sp, [uw, uh] = UW[u];
      if (uw <= S[k].L - 0.4) S[k].H.push({ u, x: 0, y: sill, w: uw, h: uh });
    });
    const g = new THREE.Group();
    for (const s of Object.values(S)) {
      g.add(placeAt(wall(s.L, s.H.map(h => ({ x: h.x, y: FL + h.y, w: h.w, h: h.h }))), s.c[0], y0, s.c[1], s.n[0], s.n[1], 0));
      for (const h of s.H) if (h.u && units[h.u]) g.add(placeAt(units[h.u].clone(true), s.c[0], y0 + FL + h.y, s.c[1], s.n[0], s.n[1], h.x));
    }
    // anthracite corner trims hide the wall ends, as on the real modules
    for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) boxAt(T + 0.03, WH, T + 0.03, M.cap, f.x / 10 + sx * w + (sx ? -T / 2 + 0.015 : T / 2 - 0.015), y0 + WH / 2, f.y / 10 + sz * d + (sz ? -T / 2 + 0.015 : T / 2 - 0.015), g);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * T, d - 2 * T), M.floor); fl.rotation.x = -Math.PI / 2; fl.position.set(cx, y0 + FL, cz); fl.receiveShadow = true; g.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * T, d - 2 * T), M.ceil); ce.rotation.x = Math.PI / 2; ce.position.set(cx, y0 + WH - ROOFT, cz); g.add(ce);
    const rf = boxAt(w - 2 * T, ROOFT - 0.02, d - 2 * T, M.roof, cx, y0 + WH - ROOFT / 2 - 0.01, cz, g); rf.castShadow = true;
    return noRay(g);
  }

  function deckModule(mods: Mod[], m: Mod): THREE.Group {
    const f = fp(m), w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2, g = new THREE.Group();
    const top = new THREE.PlaneGeometry(w, d), uv = top.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 1.12, uv.getY(i) * d / 1.12);
    const t = new THREE.Mesh(withUV2(top), M.deck); t.rotation.x = -Math.PI / 2; t.position.set(cx, y0 + 0.001, cz); t.receiveShadow = true; g.add(t);
    const b = boxAt(w, 0.14, d, M.deckSide, cx, y0 - 0.07, cz, g); b.castShadow = true; b.receiveShadow = true;
    if (!lv(m)) boxAt(w - 0.3, BASE - 0.14, d - 0.3, M.plinth, cx, (BASE - 0.14) / 2, cz, g);
    else { // terrace on an upper floor: glass guard rail on the open edges
      const sd = sides(mods, m);
      for (const [k, x, z, lw, ld] of [['N', cx, cz - d / 2 + 0.03, w, 0.04], ['S', cx, cz + d / 2 - 0.03, w, 0.04], ['W', cx - w / 2 + 0.03, cz, 0.04, d], ['E', cx + w / 2 - 0.03, cz, 0.04, d]] as const) {
        if (sd[k] === 'room') continue;
        boxAt(lw, 0.9, ld, M.glass, x, y0 + 0.45, z, g); boxAt(lw + 0.02, 0.05, ld + 0.04, M.frame, x, y0 + 0.93, z, g);
      }
    }
    return noRay(g);
  }

  // ---------- build ----------
  let pickers: THREE.Mesh[] = [];
  function build(mods: Mod[], sel: Mod | null, bad: Set<Mod>, ds: Door[]): void {
    for (const o of [...grp.children]) { grp.remove(o); o.traverse(n => (n as THREE.Mesh).geometry?.dispose()); }
    pickers = [];
    if (mods.length) {
      const fs = mods.map(fp);
      const cx = (Math.min(...fs.map(f => f.x)) + Math.max(...fs.map(f => f.x + f.w))) / 20, cz = (Math.min(...fs.map(f => f.y)) + Math.max(...fs.map(f => f.y + f.h))) / 20;
      const sd = new THREE.Vector3(-18, 30, 22).normalize();
      sun.target.position.set(cx, 0, cz); sun.position.set(cx + sd.x * 60, sd.y * 60, cz + sd.z * 60);
    }
    const covered = (m: Mod) => mods.some(o => lv(o) === lv(m) + 1 && overlaps(fp(o), fp(m)));
    for (const m of mods) {
      const deck = TYPES[m.type].kind === 'deck', f = fp(m);
      const w = f.w / 10, d = f.h / 10, y0 = BASE + lv(m) * WH, cx = f.x / 10 + w / 2, cz = f.y / 10 + d / 2, hh = deck ? 0.14 : WH;
      grp.add(deck ? deckModule(mods, m) : roomModule(mods, m, ds));
      if (!deck && !covered(m)) noRay(boxAt(w + 0.04, 0.14, d + 0.04, M.cap, cx, y0 + hh + 0.05, cz, grp)); // roof flashing
      if (!deck && !lv(m)) {
        noRay(boxAt(w - 0.3, BASE, d - 0.3, M.plinth, cx, BASE / 2, cz, grp));
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.6, d + 1.6), M.shadow); sh.rotation.x = -Math.PI / 2; sh.position.set(cx, 0.02, cz); grp.add(noRay(sh));
      }
      // invisible box used for picking and for stacking
      const pick = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d)); pick.visible = false; pick.position.set(cx, deck ? y0 - 0.07 : y0 + hh / 2, cz);
      pick.userData.m = m; grp.add(pick); pickers.push(pick);
      if (m === sel || bad.has(m)) {
        const halo = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.1, hh + 0.1, d + 0.1)), new THREE.LineBasicMaterial({ color: bad.has(m) ? 0xff8a7a : 0xe3b277 }));
        halo.position.copy(pick.position); grp.add(noRay(halo));
      }
    }
  }

  // ---------- camera ----------
  function resize(): void {
    const r = box.parentElement!.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix();
  }
  function frame(mods: Mod[]): void {
    if (!mods.length) { cam.position.set(18, 16, 22); controls.target.set(0, 0, 0); controls.update(); return; }
    const fs = mods.map(fp);
    const x0 = Math.min(...fs.map(f => f.x)) / 10, z0 = Math.min(...fs.map(f => f.y)) / 10, x1 = Math.max(...fs.map(f => f.x + f.w)) / 10, z1 = Math.max(...fs.map(f => f.y + f.h)) / 10;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0, 8);
    controls.target.set(cx + span * 0.12, 1.5, cz); cam.position.set(cx + span * 1.3, span * 0.75, cz + span * 1.65); controls.update();
  }
  function dolly(k: number): void { const v = cam.position.clone().sub(controls.target).multiplyScalar(k); cam.position.copy(controls.target).add(v); controls.update(); }
  controls.addEventListener('change', () => host.selectionMoved());

  // ---------- drag and stack ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag: { m: Mod; moved: boolean } | null = null;
  let press: { x: number; y: number } | null = null;
  const aim = (x: number, y: number) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, cam); };
  function place(m: Mod, x: number, y: number): void {
    aim(x, y);
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
    if (hit) { const m = hit.object.userData.m as Mod; host.select(m); drag = { m, moved: false }; controls.enabled = false; box.setPointerCapture(e.pointerId); host.changed(); }
  }, true);
  box.addEventListener('pointermove', e => {
    if (!drag || !press) return;
    if (!drag.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    drag.moved = true; place(drag.m, e.clientX, e.clientY);
  });
  const up = (e: PointerEvent) => {
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) { host.select(null); host.changed(); }
    if (drag) { drag = null; host.changed(); }
    controls.enabled = true; press = null;
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);

  let loop = 0;
  const tick = () => { controls.update(); renderer.render(scene, cam); loop = requestAnimationFrame(tick); };

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
    endDrag() { drag = null; },
    dragging: () => !!drag,
    frame,
    resize,
    start() { cancelAnimationFrame(loop); tick(); },
    stop() { cancelAnimationFrame(loop); },
    setFinish(f) { Object.assign(M.clad, facade(f)); M.clad.needsUpdate = true; host.changed(); },
    capture(mods, bad, ds) {
      const p = cam.position.clone(), t = controls.target.clone();
      renderer.setSize(960, 600, false); cam.aspect = 960 / 600; cam.updateProjectionMatrix(); frame(mods); dolly(0.62);
      build(mods, null, bad, ds); renderer.render(scene, cam);
      const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
      cam.position.copy(p); controls.target.copy(t); controls.update(); resize();
      return url;
    },
  };
}
