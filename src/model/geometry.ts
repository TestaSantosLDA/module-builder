import { MAX_LEVEL, MIN_DOOR_WALL, OPEN_PLAN, TYPES, type Mod } from './catalog';

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
}

/**
 * Doors created automatically between modules that touch on the same level:
 * room–room gets a door, room–deck a glass sliding door, sala–cozinha is open plan, deck–deck nothing.
 */
export function doors(mods: readonly Mod[]): Door[] {
  const out: Door[] = [];
  for (let i = 0; i < mods.length; i++) for (let j = i + 1; j < mods.length; j++) {
    const mi = mods[i], mj = mods[j];
    if (level(mi) !== level(mj)) continue;
    const di = kindOf(mi) === 'deck', dj = kindOf(mj) === 'deck';
    if (di && dj) continue;
    const a = footprint(mi), b = footprint(mj);
    const open = OPEN_PLAN.has(mi.type + '|' + mj.type), glass = di || dj;
    const base = { open, glass, z: level(mi), a: mi, b: mj };
    if (a.x + a.w === b.x || b.x + b.w === a.x) {
      const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ov >= MIN_DOOR_WALL) out.push({ ...base, x: a.x + a.w === b.x ? b.x : a.x, y: Math.max(a.y, b.y) + ov / 2, vertical: true, len: ov });
    } else if (a.y + a.h === b.y || b.y + b.h === a.y) {
      const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (ov >= MIN_DOOR_WALL) out.push({ ...base, x: Math.max(a.x, b.x) + ov / 2, y: a.y + a.h === b.y ? b.y : a.y, vertical: false, len: ov });
    }
  }
  return out;
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
    if (mods.some(m => level(m) === l) && !mods.some(m => level(m) === l - 1 && 'stairs' in TYPES[m.type]))
      msgs.push(`Falta uma escada no piso ${l - 1} para subir ao piso ${l}.`);
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
