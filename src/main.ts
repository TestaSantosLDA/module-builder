// Construtor Treehouse: 2D plan + 3D view, undo, and the quote request.
// Pure rules live in src/model (tested); this file is the browser UI.
import './style.css';
import { CATEGORIES, MAX_LEVEL, TYPES, type Mod, type TypeId } from './model/catalog';
import { doors, footprint as fp, level as lv, problems, snapToNeighbours, summarize, type Door } from './model/geometry';
import { History } from './model/history';
import { DEFAULT_HOUSE, FAMILIES, HOUSES, houseById, placeHouse } from './model/houses';
import { parsePlan } from './model/plan';
import { createView3D, type View3D } from './ui/view3d';
import { interior } from './ui/sketch';
import { setupQuote } from './ui/quote';

const NS = 'http://www.w3.org/2000/svg';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById('board') as unknown as SVGSVGElement;
const main = $('main');

// ---------- state ----------
let mods: Mod[] = [];
let sel: Mod | null = null;
let nextId = 1;
let curLevel = 0;
let is3D = false;
const view = { tx: 0, ty: 0, s: 6 };
let drag: { m: Mod; dx: number; dy: number; moved: boolean } | null = null;
let pan: { x: number; y: number; tx: number; ty: number } | null = null;
let view3d: View3D | null = null;

const STORE = 'treehouse-construtor-v1';
const history = new History(5);

function el(tag: string, attrs: Record<string, string | number> = {}, parent?: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
const m1 = (dm: number) => (dm / 10).toFixed(1).replace('.', ',');

// ---------- palette ----------
const modsBox = $('mods');
let paletteAll = false;
function modButton(k: TypeId): HTMLButtonElement {
  const t = TYPES[k];
  const b = document.createElement('button');
  b.className = 'mod'; b.type = 'button'; b.dataset.type = k;
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `-2 -2 ${t.h + 4} ${t.w + 4}`);
  const g = el('g', { transform: `translate(${t.h},0) rotate(90)` }, s);
  const deck = t.kind === 'deck';
  el('rect', { x: 0, y: 0, width: t.w, height: t.h, fill: deck ? 'none' : 'var(--paper-deep)', stroke: 'var(--ink)', 'stroke-width': 1.6, 'stroke-dasharray': deck ? '3 2' : 'none' }, g);
  interior(g, k, t.w, t.h);
  b.appendChild(s);
  b.insertAdjacentHTML('beforeend', `<b>${t.name}</b><span>${m1(t.w)}×${m1(t.h)} m<br>${Math.round(t.w * t.h / 100)} m²</span>`);
  return b;
}
const ALL_TYPES = Object.keys(TYPES) as TypeId[];
$('pAllN').textContent = `(${ALL_TYPES.length})`;
/** "Desta casa": the pieces of the start house plus what is on the plan now, and stairs. "Todos": every type by category. */
function renderPalette(): void {
  $('pHouse').setAttribute('aria-selected', String(!paletteAll)); $('pAll').setAttribute('aria-selected', String(paletteAll));
  modsBox.innerHTML = '';
  if (!paletteAll) {
    const used = new Set<TypeId>([...(houseById(houseId)?.plan.map(p => p.type) ?? []), ...mods.map(m => m.type), 'escada']);
    const grid = document.createElement('div'); grid.className = 'mods';
    for (const c of CATEGORIES) for (const k of ALL_TYPES) if (used.has(k) && TYPES[k].cat === c.id) grid.appendChild(modButton(k));
    modsBox.appendChild(grid);
    return;
  }
  for (const c of CATEGORIES) {
    const ks = ALL_TYPES.filter(k => TYPES[k].cat === c.id);
    if (!ks.length) continue;
    const d = document.createElement('details'); d.className = 'cat'; d.open = c.id === 'sala';
    d.innerHTML = `<summary>${c.name} <small>${ks.length}</small></summary>`;
    const grid = document.createElement('div'); grid.className = 'mods';
    ks.forEach(k => grid.appendChild(modButton(k)));
    d.appendChild(grid); modsBox.appendChild(d);
  }
}
$('pHouse').onclick = () => { paletteAll = false; renderPalette(); };
$('pAll').onclick = () => { paletteAll = true; renderPalette(); };

// ---------- geometry helpers ----------
const toWorld = (cx: number, cy: number) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - view.tx) / view.s, y: (cy - r.top - view.ty) / view.s }; };
const toScreen = (x: number, y: number) => ({ x: x * view.s + view.tx, y: y * view.s + view.ty });
const snap = Math.round;

// ---------- render ----------
function render(): void {
  const { bad, msgs } = problems(mods), ds = doors(mods), s = summarize(mods);
  $('sMods').textContent = String(s.rooms);
  $('sArea').textContent = String(s.area);
  $('sDeck').textContent = String(s.deck);
  $('sDoors').textContent = String(ds.length);
  $('sFloors').textContent = String(s.floors);
  const w = $('warn'); w.hidden = !msgs.length; w.textContent = msgs.join(' ');
  for (const b of document.querySelectorAll<HTMLButtonElement>('#floors button')) {
    const l = Number(b.dataset.l);
    b.setAttribute('aria-pressed', String(l === curLevel));
    b.style.fontWeight = mods.some(m => lv(m) === l) ? '700' : '400';
  }
  save();
  if (is3D && view3d) { view3d.build(mods, sel, bad, ds); placeSelbar(); return; }
  render2D(bad, ds);
}

function render2D(bad: Set<Mod>, ds: Door[]): void {
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const p1 = el('pattern', { id: 'g1', width: 10, height: 10, patternUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M10 0H0V10', fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, p1);
  const p5 = el('pattern', { id: 'g5', width: 50, height: 50, patternUnits: 'userSpaceOnUse' }, defs);
  el('rect', { width: 50, height: 50, fill: 'url(#g1)' }, p5);
  el('path', { d: 'M50 0H0V50', fill: 'none', stroke: 'var(--grid-major)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, p5);
  const world = el('g', { transform: `translate(${view.tx},${view.ty}) scale(${view.s})` }, svg);
  el('rect', { x: -2000, y: -2000, width: 4000, height: 4000, fill: 'url(#g5)' }, world);
  // floor below, as a ghost
  for (const m of mods.filter(m => lv(m) === curLevel - 1)) {
    const f = fp(m);
    el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, fill: 'none', stroke: 'var(--ink-dim)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.6, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, world);
  }
  const here = mods.filter(m => lv(m) === curLevel);
  for (const m of here) {
    const t = TYPES[m.type], f = fp(m), deck = t.kind === 'deck';
    const g = el('g', { class: 'm', 'data-id': m.id, style: 'cursor:move' }, world);
    const lg = el('g', { transform: `translate(${f.x + f.w / 2},${f.y + f.h / 2}) rotate(${m.rot}) translate(${-t.w / 2},${-t.h / 2})` }, g);
    el('rect', { x: 0, y: 0, width: t.w, height: t.h, fill: deck ? 'rgba(227,178,119,.06)' : 'var(--paper-deep)', stroke: bad.has(m) ? 'var(--bad)' : (m === sel ? 'var(--wood)' : 'var(--ink)'), 'stroke-width': deck ? 1.2 : 3, 'stroke-dasharray': deck ? '6 4' : 'none', 'vector-effect': 'non-scaling-stroke' }, lg);
    interior(lg, m.type, t.w, t.h);
  }
  // doors on shared walls
  for (const d of ds.filter(d => d.z === curLevel)) {
    const BG = { stroke: 'var(--paper-deep)', 'stroke-width': 6, 'vector-effect': 'non-scaling-stroke' };
    if (d.open || d.glass) {
      const single = d.glass && !d.open && d.len < 22;
      const hl = d.open ? d.len / 2 - 1.5 : single ? Math.min(4.5, d.len / 2 - 1) : Math.min(9, d.len / 2 - 1.5);
      if (d.vertical) el('line', { ...BG, x1: d.x, y1: d.y - hl, x2: d.x, y2: d.y + hl }, world);
      else el('line', { ...BG, x1: d.x - hl, y1: d.y, x2: d.x + hl, y2: d.y }, world);
      if (single) {
        const G = { stroke: '#7fd3ff', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' };
        if (d.vertical) el('line', { ...G, x1: d.x, y1: d.y - hl, x2: d.x, y2: d.y + hl }, world);
        else el('line', { ...G, x1: d.x - hl, y1: d.y, x2: d.x + hl, y2: d.y }, world);
      } else if (d.glass) {
        const G = { stroke: '#7fd3ff', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' };
        if (d.vertical) { el('line', { ...G, x1: d.x - 0.5, y1: d.y - hl, x2: d.x - 0.5, y2: d.y + 1 }, world); el('line', { ...G, x1: d.x + 0.5, y1: d.y - 1, x2: d.x + 0.5, y2: d.y + hl }, world); }
        else { el('line', { ...G, x1: d.x - hl, y1: d.y - 0.5, x2: d.x + 1, y2: d.y - 0.5 }, world); el('line', { ...G, x1: d.x - 1, y1: d.y + 0.5, x2: d.x + hl, y2: d.y + 0.5 }, world); }
      }
      continue;
    }
    const half = 4.5, S = { stroke: 'var(--wood)', 'stroke-width': 1.2, fill: 'none', 'vector-effect': 'non-scaling-stroke' };
    if (d.vertical) {
      el('line', { ...BG, x1: d.x, y1: d.y - half, x2: d.x, y2: d.y + half }, world);
      el('line', { ...S, x1: d.x, y1: d.y - half, x2: d.x + 9, y2: d.y - half }, world);
      el('path', { ...S, d: `M${d.x + 9} ${d.y - half} A9 9 0 0 1 ${d.x} ${d.y + half}`, 'stroke-dasharray': '1.5 1.5' }, world);
    } else {
      el('line', { ...BG, x1: d.x - half, y1: d.y, x2: d.x + half, y2: d.y }, world);
      el('line', { ...S, x1: d.x - half, y1: d.y, x2: d.x - half, y2: d.y + 9 }, world);
      el('path', { ...S, d: `M${d.x - half} ${d.y + 9} A9 9 0 0 0 ${d.x + half} ${d.y}`, 'stroke-dasharray': '1.5 1.5' }, world);
    }
  }
  // labels (never rotated)
  for (const m of here) {
    const f = fp(m), fs = Math.max(2.2, 11 / view.s);
    const tx = el('text', { x: f.x + f.w / 2, y: f.y + f.h / 2, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-family': 'var(--f-ui)', 'font-weight': 600, 'font-size': fs, 'pointer-events': 'none', style: `paint-order:stroke;stroke:var(--paper-deep);stroke-width:${fs * 0.35}` }, world);
    tx.textContent = TYPES[m.type].name;
    const t2 = el('text', { x: f.x + f.w / 2, y: f.y + f.h / 2 + fs * 1.25, 'text-anchor': 'middle', fill: 'var(--ink-dim)', 'font-family': 'var(--f-mono)', 'font-size': fs * 0.85, 'pointer-events': 'none', style: `paint-order:stroke;stroke:var(--paper-deep);stroke-width:${fs * 0.3}` }, world);
    t2.textContent = `${m1(f.w)} × ${m1(f.h)} m`;
  }
  // dimension line for the selection
  if (sel && lv(sel) === curLevel) {
    const f = fp(sel), o = 4, S = { stroke: 'var(--wood)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' };
    el('line', { ...S, x1: f.x, y1: f.y - o, x2: f.x + f.w, y2: f.y - o }, world);
    el('line', { ...S, x1: f.x, y1: f.y - o - 1.5, x2: f.x, y2: f.y - o + 1.5 }, world);
    el('line', { ...S, x1: f.x + f.w, y1: f.y - o - 1.5, x2: f.x + f.w, y2: f.y - o + 1.5 }, world);
  }
  $('sbar').style.width = 10 * view.s + 'px';
  placeSelbar();
}

function placeSelbar(): void {
  const bar = $('selbar');
  if (!sel || drag || view3d?.dragging() || (!is3D && lv(sel) !== curLevel)) { bar.hidden = true; return; }
  const f = fp(sel), mr = main.getBoundingClientRect();
  const p = is3D && view3d ? view3d.screenOf(sel, mr) : toScreen(f.x + f.w / 2, f.y);
  bar.hidden = false;
  bar.style.left = Math.min(Math.max(p.x, 110), mr.width - 110) + 'px';
  bar.style.top = Math.max(p.y - 10, 60) + 'px';
}

// ---------- 2D interactions ----------
svg.addEventListener('pointerdown', e => {
  const g = (e.target as Element).closest('g.m') as SVGGElement | null;
  if (g) {
    const m = mods.find(x => x.id === Number(g.dataset.id))!;
    sel = m;
    const w = toWorld(e.clientX, e.clientY);
    drag = { m, dx: w.x - m.x, dy: w.y - m.y, moved: false };
    svg.setPointerCapture(e.pointerId); render(); return;
  }
  sel = null; pan = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  svg.classList.add('panning'); svg.setPointerCapture(e.pointerId); render();
});
svg.addEventListener('pointermove', e => {
  if (drag) {
    const w = toWorld(e.clientX, e.clientY);
    drag.m.x = snap(w.x - drag.dx); drag.m.y = snap(w.y - drag.dy);
    snapToNeighbours(mods, drag.m); drag.moved = true; render();
  } else if (pan) { view.tx = pan.tx + e.clientX - pan.x; view.ty = pan.ty + e.clientY - pan.y; render(); }
});
const endDrag = () => { if (drag || pan) { drag = null; pan = null; svg.classList.remove('panning'); render(); } };
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
function zoomAt(px: number, py: number, k: number): void {
  const ns = Math.min(20, Math.max(1.2, view.s * k)); k = ns / view.s;
  view.tx = px - (px - view.tx) * k; view.ty = py - (py - view.ty) * k; view.s = ns; render();
}
$('zin').onclick = () => { if (is3D) return view3d?.dolly(0.8); const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
$('zout').onclick = () => { if (is3D) return view3d?.dolly(1.25); const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };

// drag from the palette (a click drops the module next to the house)
modsBox.addEventListener('pointerdown', e => {
  const b = (e.target as Element).closest<HTMLElement>('.mod'); if (!b) return;
  e.preventDefault();
  const type = b.dataset.type as TypeId, t = TYPES[type];
  const start = { x: e.clientX, y: e.clientY };
  let m: Mod | null = null;
  const mv = (ev: PointerEvent) => {
    if (!m && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
    if (!m) {
      m = { id: nextId++, type, x: 0, y: 0, rot: 0, z: is3D ? 0 : curLevel };
      mods.push(m); sel = m;
      if (is3D) view3d?.startDrag(m); else drag = { m, dx: t.w / 2, dy: t.h / 2, moved: true };
    }
    if (is3D) { view3d?.place(m, ev.clientX, ev.clientY); return; }
    const w = toWorld(ev.clientX, ev.clientY);
    m.x = snap(w.x - t.w / 2); m.y = snap(w.y - t.h / 2); snapToNeighbours(mods, m); render();
  };
  const up = (ev: PointerEvent) => {
    document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
    if (!m) { addNear(type); return; }
    const r = main.getBoundingClientRect(), pr = document.querySelector('.palette')!.getBoundingClientRect();
    const overPalette = ev.clientX >= pr.left && ev.clientX <= pr.right && ev.clientY >= pr.top && ev.clientY <= pr.bottom;
    if (overPalette || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) { const gone = m; mods = mods.filter(x => x !== gone); sel = null; }
    drag = null; view3d?.endDrag(); render();
  };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
});

function addNear(type: TypeId): void {
  const t = TYPES[type];
  const m: Mod = { id: nextId++, type, x: 0, y: 0, rot: 0, z: is3D ? 0 : curLevel };
  const same = mods.filter(o => lv(o) === lv(m));
  if (!same.length && mods.length) {
    const below = mods.filter(o => lv(o) === lv(m) - 1).map(fp)[0];
    if (below) { m.x = below.x; m.y = below.y; }
  } else if (!mods.length) {
    const r = svg.getBoundingClientRect(), c = toWorld(r.left + r.width * 0.55, r.top + r.height * 0.5);
    m.x = snap(c.x - t.w / 2); m.y = snap(c.y - t.h / 2);
  } else {
    const xs = same.map(fp);
    m.x = Math.max(...xs.map(f => f.x + f.w)); m.y = Math.min(...xs.map(f => f.y));
  }
  mods.push(m); sel = m; render();
}

// ---------- selection actions ----------
function rotate(): void {
  if (!sel) return;
  const before = fp(sel);
  sel.rot = ((sel.rot + 90) % 360) as Mod['rot'];
  const after = fp(sel);
  sel.x = snap(before.x + before.w / 2 - after.w / 2); sel.y = snap(before.y + before.h / 2 - after.h / 2);
  render();
}
function moveLevel(d: number): void {
  if (!sel) return;
  const z = Math.min(MAX_LEVEL, Math.max(0, lv(sel) + d));
  if (z === lv(sel)) return;
  sel.z = z; snapToNeighbours(mods, sel);
  if (!is3D) curLevel = z;
  render();
}
function del(): void { if (!sel) return; const gone = sel; mods = mods.filter(x => x !== gone); sel = null; render(); }
function dup(): void { if (!sel) return; const f = fp(sel); const m = { ...sel, id: nextId++, x: f.x + f.w }; mods.push(m); sel = m; render(); }
$('bUp').onclick = () => moveLevel(1);
$('bDown').onclick = () => moveLevel(-1);
$('bRot').onclick = rotate; $('bDel').onclick = del; $('bDup').onclick = dup;
for (const b of document.querySelectorAll<HTMLButtonElement>('#floors button'))
  b.onclick = () => { curLevel = Number(b.dataset.l); if (sel && lv(sel) !== curLevel) sel = null; render(); };

document.addEventListener('keydown', e => {
  if (!$('modal').hidden || (e.target as Element).closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (e.key === 'r' || e.key === 'R') rotate();
  else if (e.key === 'PageUp') moveLevel(1);
  else if (e.key === 'PageDown') moveLevel(-1);
  else if (e.key === 'Delete' || e.key === 'Backspace') del();
  else if (e.key === 'Escape') { sel = null; render(); }
});

// ---------- start house, clear, fit ----------
// ---------- start house ----------
const HOUSE_KEY = 'treehouse-casa';
let houseId = DEFAULT_HOUSE;
try { const h = localStorage.getItem(HOUSE_KEY); if (houseById(h)) houseId = h!; } catch { /* storage blocked */ }
const housesBox = $('houses');
for (const fam of FAMILIES) {
  const hs = HOUSES.filter(h => h.family === fam);
  if (!hs.length) continue;
  housesBox.insertAdjacentHTML('beforeend', `<small>${fam}</small>`);
  const row = document.createElement('div');
  for (const h of hs) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.house = h.id; b.textContent = h.label;
    b.title = `${h.name} · ${h.catalogArea} · catálogo p. ${h.page}`;
    b.onclick = () => loadHouse(h.id);
    row.appendChild(b);
  }
  housesBox.appendChild(row);
}
function showHouse(): void {
  const h = houseById(houseId)!;
  for (const b of housesBox.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.house === houseId));
  $('houseNote').textContent = `${h.name} (${h.catalogArea}, catálogo p. ${h.page}), partida nas suas peças.`;
}
function loadHouse(id: string): void {
  const h = houseById(id); if (!h) return;
  houseId = id;
  try { localStorage.setItem(HOUSE_KEY, id); } catch { /* storage blocked */ }
  curLevel = 0; mods = placeHouse(h, () => nextId++); sel = null; showHouse(); renderPalette(); fit();
}
const loadRiga = () => loadHouse(houseId);
function fit(): void {
  if (is3D) { view3d?.frame(mods); render(); return; }
  if (!mods.length) { render(); return; }
  const r = svg.getBoundingClientRect(), fs = mods.map(fp);
  const x0 = Math.min(...fs.map(f => f.x)), y0 = Math.min(...fs.map(f => f.y)), x1 = Math.max(...fs.map(f => f.x + f.w)), y1 = Math.max(...fs.map(f => f.y + f.h));
  const narrow = r.width < 640, padL = narrow ? 20 : 290, padR = narrow ? 20 : 300, padT = narrow ? 150 : 40, padB = narrow ? 190 : 40;
  const s = Math.min((r.width - padL - padR) / (x1 - x0), (r.height - padT - padB) / (y1 - y0));
  view.s = Math.min(8, Math.max(1.2, s * 0.56)); // leave plenty of room around the house
  view.tx = padL + ((r.width - padL - padR) - (x1 - x0) * view.s) / 2 - x0 * view.s;
  view.ty = padT + ((r.height - padT - padB) - (y1 - y0) * view.s) / 2 - y0 * view.s;
  render();
}
$('example').onclick = loadRiga;
$('clear').onclick = () => { mods = []; sel = null; render(); };

// ---------- 3D ----------
function ensure3D(): View3D | null {
  if (!view3d) {
    view3d = createView3D($('view3d'), {
      kitUrl: import.meta.env.BASE_URL + 'kit/',
      getMods: () => mods,
      select: m => { sel = m; },
      changed: render,
      selectionMoved: placeSelbar,
      snap: m => snapToNeighbours(mods, m),
    });
    if (!view3d) { const t = $<HTMLButtonElement>('tab3d'); t.disabled = true; t.title = 'Não foi possível abrir o 3D neste navegador'; return null; }
    view3d.setFinish(finish);
  }
  return view3d;
}
function setView(three: boolean): void {
  if (three && !ensure3D()) return;
  is3D = three;
  $('tab2d').setAttribute('aria-pressed', String(!three)); $('tab3d').setAttribute('aria-pressed', String(three));
  (svg as unknown as HTMLElement).hidden = three; $('view3d').hidden = !three;
  $('floors').hidden = three; $('tip3d').hidden = !three; $('finish').hidden = !three;
  (document.querySelector('.scalebar') as HTMLElement).hidden = three;
  if (three && view3d) { view3d.resize(); view3d.frame(mods); view3d.start(); render(); }
  else { view3d?.stop(); if (sel) curLevel = lv(sel); render(); }
}
$('tab2d').onclick = () => setView(false);
$('tab3d').onclick = () => setView(true);
window.addEventListener('resize', () => { view3d?.resize(); render(); });

const FINISHES = ['branco', 'madeira', 'grafite'] as const;
type Finish = (typeof FINISHES)[number];
let finish: Finish = 'branco';
try { const f = localStorage.getItem('treehouse-fachada'); if (FINISHES.includes(f as Finish)) finish = f as Finish; } catch { /* storage blocked */ }
function setFinish(f: Finish): void {
  finish = f;
  try { localStorage.setItem('treehouse-fachada', f); } catch { /* storage blocked */ }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#finish button[data-f]')) b.setAttribute('aria-pressed', String(b.dataset.f === f));
  view3d?.setFinish(f); render();
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#finish button[data-f]')) {
  b.setAttribute('aria-pressed', String(b.dataset.f === finish));
  b.onclick = () => setFinish(b.dataset.f as Finish);
}

// ---------- quote request ----------
setupQuote({
  getMods: () => mods,
  finish: () => finish,
  house: () => houseId,
  capture: () => ensure3D()?.capture(mods, problems(mods).bad, doors(mods)) ?? null,
});

// ---------- undo + persistence ----------
function save(): void {
  const now = JSON.stringify(mods);
  if (!drag && !view3d?.dragging()) { history.commit(now); updUndo(); }
  try { localStorage.setItem(STORE, now); } catch { /* storage blocked */ }
}
function updUndo(): void { $<HTMLButtonElement>('undo').disabled = !history.size; $('undoN').textContent = String(history.size); }
function undo(): void {
  if (drag || view3d?.dragging()) return;
  const prev = history.undo(); if (prev === null) return;
  mods = parsePlan(JSON.parse(prev)) ?? [];
  nextId = Math.max(nextId, ...mods.map(m => m.id + 1)); sel = null; render();
}
$('undo').onclick = undo;

let loaded: Mod[] | null = null;
try { loaded = parsePlan(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch { /* ignore */ }
showHouse();
requestAnimationFrame(() => {
  renderPalette();
  if (loaded && loaded.length) { mods = loaded; nextId = Math.max(...mods.map(m => m.id)) + 1; fit(); }
  else loadRiga();
});

