import { isTypeId, MAX_LEVEL, type Mod } from './catalog.js';
import { DIRS, isOpening, isOutChoice, type Opening } from './openings.js';

export const MAX_MODULES = 60;

/** Checks a plan that came from storage or the network; returns null when it is not a valid plan. */
export function parsePlan(data: unknown): Mod[] | null {
  if (!Array.isArray(data) || data.length > MAX_MODULES) return null;
  const out: Mod[] = [];
  for (const d of data) {
    if (!d || typeof d !== 'object') return null;
    const { id, type, x, y, rot, z, flip, join, out: side } = d as Record<string, unknown>;
    if (!isTypeId(type)) return null;
    if (![id, x, y, z].every(v => Number.isInteger(v) && Math.abs(v as number) < 100000)) return null;
    if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) return null;
    if ((z as number) < 0 || (z as number) > MAX_LEVEL) return null;
    const m: Mod = { id: id as number, type, x: x as number, y: y as number, rot, z: z as number };
    if (Array.isArray(flip) && flip.length <= MAX_MODULES && flip.every(v => Number.isInteger(v))) m.flip = flip as number[];
    if (join && typeof join === 'object' && !Array.isArray(join)) {
      const j: Record<number, Opening> = {};
      for (const [k, v] of Object.entries(join).slice(0, MAX_MODULES)) if (/^\d+$/.test(k) && isOpening(v)) j[Number(k)] = v;
      if (Object.keys(j).length) m.join = j;
    }
    if (side && typeof side === 'object' && !Array.isArray(side)) {
      const o: Mod['out'] = {};
      for (const k of DIRS) { const v = (side as Record<string, unknown>)[k]; if (isOutChoice(v)) o[k] = typeof v === 'string' ? v : v.map(p => (p.at === undefined ? { k: p.k } : { k: p.k, at: p.at })); }
      if (Object.keys(o).length) m.out = o;
    }
    out.push(m);
  }
  return out;
}
