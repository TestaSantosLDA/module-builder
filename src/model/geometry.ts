import { isOpenPlan, MAX_LEVEL, MIN_DOOR_WALL, roleOf, TYPES, type Mod, type Role } from './catalog.js';

export interface Rect { x: number; y: number; w: number; h: number }

export const level = (m: Mod): number => m.z || 0;
export const kindOf = (m: Mod) => TYPES[m.type].kind;

/** Footprint of a module after rotation. */
export function footprint(m: Mod): Rect {
  const t = TYPES[m.type];
  const turned = m.rot % 180 !== 0;
  return { x: m.x, y: m.y, w: turned ? t.h : t.w, h: turned ? t.w : t.h };
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const SNAP = 5;

/** Moves `m` (in place) so it lines up with nearby modules on its level, or with the floor below. */
export function snapToNeighbours(mods: readonly Mod[], m: Mod): void {
  const a = footprint(m);
  let bx: number | null = null;
  let by: number | null = null;
  const tryX = (c: number) => { if (Math.abs(a.x - c) < SNAP && (bx === null || Math.abs(a.x - c) < Math.abs(a.x - bx))) bx = c; };
  const tryY = (c: number) => { if (Math.abs(a.y - c) < SNAP && (by === null || Math.abs(a.y - c) < Math.abs(a.y - by))) by = c; };
  for (const o of mods) {
    if (o === m) continue;
    const b = footprint(o);
    if (level(o) === level(m) - 1) {
      if (a.y < b.y + b.h && b.y < a.y + a.h) [b.x, b.x + b.w - a.w].forEach(tryX);
      if (a.x < b.x + b.w && b.x < a.x + a.w) [b.y, b.y + b.h - a.h].forEach(tryY);
      continue;
    }
    if (level(o) !== level(m)) continue;
    const nearY = a.y < b.y + b.h + SNAP && b.y < a.y + a.h + SNAP;
    const nearX = a.x < b.x + b.w + SNAP && b.x < a.x + a.w + SNAP;
    if (nearY) [b.x + b.w, b.x - a.w, b.x, b.x + b.w - a.w].forEach(tryX);
    if (nearX) [b.y + b.h, b.y - a.h, b.y, b.y + b.h - a.h].forEach(tryY);
  }
  if (bx !== null) m.x = bx;
  if (by !== null) m.y = by;
}

export interface Door {
  /** centre of the opening on the shared wall, dm */
  x: number;
  y: number;
  /** true when the shared wall runs along y */
  vertical: boolean;
  /** length of the shared wall, dm */
  len: number;
  /** open plan (sala + cozinha): no wall at all */
  open: boolean;
  /** room meets deck: glass sliding door */
  glass: boolean;
  z: number;
  a: Mod;
  b: Mod;
  /** plain wall instead of an opening (the rule's choice, flipped by the user) */
  wall: boolean;
}

/**
 * Doors created automatically between modules that touch on the same level:
 * room–room gets a door, room–deck a glass sliding door, sala–cozinha is open plan, deck–deck nothing.
 */
export function doors(mods: readonly Mod[]): Door[] {
  return connections(mods).filter(d => !d.wall);
}

/** Has the user flipped the wall between a and b? (stored on either module) */
export const flipped = (a: Mod, b: Mod) => !!(a.flip?.includes(b.id) || b.flip?.includes(a.id));

/**
 * Default before any flip: should this shared wall be a plain wall?
 * Bedrooms don't open into each other, bathrooms don't open onto the living room, the kitchen or another bathroom,
 * and bathrooms and stairs don't open onto a deck. Halls and stairs open to everything else.
 */
export function ruleWall(a: Mod, b: Mod): boolean {
  const ra = roleOf(a.type), rb = roleOf(b.type), has = (r: Role) => ra === r || rb === r;
  if (ra === 'bed' && rb === 'bed') return true;
  if (ra === 'wc' && rb === 'wc') return true;
  if (has('wc') && has('living')) return true;
  if (has('deck') && (has('wc') || has('stairs'))) return true;
  return false;
}

/** Fewer is better: which neighbour a room with no way in should open to first. */
const ACCESS_PREF: Record<Role, number> = { hall: 0, living: 1, stairs: 2, deck: 3, bed: 4, wc: 5 };

/** Flip the shared wall between a and b (door ↔ wall). */
export function toggleWall(a: Mod, b: Mod): void {
  const on = flipped(a, b);
  for (const [m, o] of [[a, b], [b, a]] as const) { m.flip = (m.flip ?? []).filter(i => i !== o.id); if (!m.flip.length) delete m.flip; }
  if (!on) (a.flip ??= []).push(b.id);
}

/** Every shared wall between touching modules (deck–deck excluded), with its opening or `wall: true`. */
export function connections(mods: readonly Mod[]): Door[] {
  const out: Door[] = [];
  for (let i = 0; i < mods.length; i++) for (let j = i + 1; j < mods.length; j++) {
    const mi = mods[i], mj = mods[j];
    if (level(mi) !== level(mj)) continue;
    const di = kindOf(mi) === 'deck', dj = kindOf(mj) === 'deck';
    if (di && dj) continue;
    const a = footprint(mi), b = footprint(mj);
    const open = isOpenPlan(mi.type, mj.type), glass = di || dj;
    const base = { open, glass, z: level(mi), a: mi, b: mj, wall: ruleWall(mi, mj) };
    if (a.x + a.w === b.x || b.x + b.w === a.x) {
      const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ov >= MIN_DOOR_WALL) out.push({ ...base, x: a.x + a.w === b.x ? b.x : a.x, y: Math.max(a.y, b.y) + ov / 2, vertical: true, len: ov });
    } else if (a.y + a.h === b.y || b.y + b.h === a.y) {
      const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (ov >= MIN_DOOR_WALL) out.push({ ...base, x: Math.max(a.x, b.x) + ov / 2, y: a.y + a.h === b.y ? b.y : a.y, vertical: false, len: ov });
    }
  }
  // a room the rules would close off completely keeps one door, to its best neighbour
  for (const m of mods) {
    if (kindOf(m) !== 'room') continue;
    const mine = out.filter(d => d.a === m || d.b === m);
    if (!mine.length || mine.some(d => !d.wall)) continue;
    const other = (d: Door) => (d.a === m ? d.b : d.a);
    mine.sort((x, y) => ACCESS_PREF[roleOf(other(x).type)] - ACCESS_PREF[roleOf(other(y).type)])[0].wall = false;
  }
  for (const d of out) if (flipped(d.a, d.b)) d.wall = !d.wall;
  return out;
}

/** Rooms that can't be reached: no opening at all, or a group of rooms with no way in from a deck, a hall or the stairs. */
export function unreachable(mods: readonly Mod[]): Mod[] {
  const rooms = mods.filter(m => kindOf(m) === 'room');
  if (rooms.length < 2) return [];
  const open = doors(mods), adj = new Map<Mod, Mod[]>(rooms.map(r => [r, []]));
  const entry = new Set<Mod>(rooms.filter(r => ['hall', 'stairs'].includes(roleOf(r.type))));
  // upstairs, the stairs arrive in the rooms above them (or anywhere on that floor if none is above them)
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const up = rooms.filter(r => level(r) === l), st = rooms.filter(r => level(r) === l - 1 && TYPES[r.type].stairs);
    const above = up.filter(r => st.some(s => overlaps(footprint(r), footprint(s))));
    for (const r of above.length ? above : up) entry.add(r);
  }
  for (const d of open) {
    const da = kindOf(d.a) === 'deck', db = kindOf(d.b) === 'deck';
    if (da && !db) entry.add(d.b); else if (db && !da) entry.add(d.a);
    else if (!da && !db) { adj.get(d.a)!.push(d.b); adj.get(d.b)!.push(d.a); }
  }
  // no hall and no deck on the ground floor: the front door is in the living room
  if (![...entry].some(r => !level(r))) for (const r of rooms) if (!level(r) && roleOf(r.type) === 'living') entry.add(r);
  if (!entry.size) return [];
  const seen = new Set<Mod>(entry), q = [...entry];
  while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return rooms.filter(r => !seen.has(r));
}

export interface Problems { bad: Set<Mod>; msgs: string[] }

/** Overlaps, modules floating on an upper floor, and missing stairs. */
export function problems(mods: readonly Mod[]): Problems {
  const bad = new Set<Mod>(), msgs: string[] = [];
  for (let i = 0; i < mods.length; i++) for (let j = i + 1; j < mods.length; j++)
    if (level(mods[i]) === level(mods[j]) && overlaps(footprint(mods[i]), footprint(mods[j]))) { bad.add(mods[i]); bad.add(mods[j]); }
  if (bad.size) msgs.push('Há módulos sobrepostos.');
  let floating = false;
  for (const m of mods) {
    if (!level(m)) continue;
    const a = footprint(m);
    let covered = 0;
    for (const o of mods) {
      if (level(o) !== level(m) - 1 || kindOf(o) === 'deck') continue;
      const b = footprint(o);
      covered += Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    }
    if (covered < a.w * a.h * 0.98) { bad.add(m); floating = true; }
  }
  if (floating) msgs.push('Há módulos no ar: um piso de cima tem de assentar em divisões do piso de baixo.');
  for (let l = 1; l <= MAX_LEVEL; l++)
    if (mods.some(m => level(m) === l) && !mods.some(m => level(m) === l - 1 && TYPES[m.type].stairs))
      msgs.push(`Falta uma escada no piso ${l - 1} para subir ao piso ${l}.`);
  const shut = unreachable(mods);
  if (shut.length) msgs.push(`Sem acesso: ${[...new Set(shut.map(m => TYPES[m.type].name))].join(', ')}. Carregue numa parede para abrir uma porta.`);
  return { bad, msgs };
}

export type Side = 'free' | 'room' | 'deck';

/** What touches each outside wall of a room on the same level (N = smaller y). */
export function sides(mods: readonly Mod[], m: Mod): Record<'N' | 'S' | 'W' | 'E', Side> {
  const f = footprint(m);
  const out: Record<'N' | 'S' | 'W' | 'E', Side> = { N: 'free', S: 'free', W: 'free', E: 'free' };
  for (const o of mods) {
    if (o === m || level(o) !== level(m)) continue;
    const b = footprint(o), k = kindOf(o);
    const ovx = Math.min(f.x + f.w, b.x + b.w) - Math.max(f.x, b.x);
    const ovy = Math.min(f.y + f.h, b.y + b.h) - Math.max(f.y, b.y);
    const mark = (s: keyof typeof out) => { if (out[s] !== 'room') out[s] = k === 'deck' ? (out[s] === 'free' ? 'deck' : out[s]) : 'room'; };
    if (ovx >= MIN_DOOR_WALL && b.y + b.h === f.y) mark('N');
    if (ovx >= MIN_DOOR_WALL && b.y === f.y + f.h) mark('S');
    if (ovy >= MIN_DOOR_WALL && b.x + b.w === f.x) mark('W');
    if (ovy >= MIN_DOOR_WALL && b.x === f.x + f.w) mark('E');
  }
  return out;
}

export interface Summary {
  floors: number;
  rows: { level: number; items: string[] }[];
  rooms: number;
  area: number;
  deck: number;
  doors: number;
  msgs: string[];
}

const areaOf = (ms: readonly Mod[]) => Math.round(ms.reduce((s, m) => s + TYPES[m.type].w * TYPES[m.type].h, 0) / 100);

/** Figures shown in the side panel and sent with a quote request (areas in m²). */
export function summarize(mods: readonly Mod[]): Summary {
  const floors = mods.length ? Math.max(...mods.map(level)) + 1 : 0;
  const rows: Summary['rows'] = [];
  for (let l = 0; l < floors; l++) {
    const count = new Map<string, number>();
    for (const m of mods) if (level(m) === l) count.set(TYPES[m.type].name, (count.get(TYPES[m.type].name) || 0) + 1);
    rows.push({ level: l, items: [...count].map(([k, v]) => `${v} × ${k}`) });
  }
  const rooms = mods.filter(m => kindOf(m) === 'room');
  return { floors, rows, rooms: rooms.length, area: areaOf(rooms), deck: areaOf(mods.filter(m => kindOf(m) === 'deck')), doors: doors(mods).length, msgs: problems(mods).msgs };
}
