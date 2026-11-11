import { isTypeId, MAX_LEVEL, type Mod } from './catalog.js';

export const MAX_MODULES = 60;

/** Checks a plan that came from storage or the network; returns null when it is not a valid plan. */
export function parsePlan(data: unknown): Mod[] | null {
  if (!Array.isArray(data) || data.length > MAX_MODULES) return null;
  const out: Mod[] = [];
  for (const d of data) {
    if (!d || typeof d !== 'object') return null;
    const { id, type, x, y, rot, z } = d as Record<string, unknown>;
    if (!isTypeId(type)) return null;
    if (![id, x, y, z].every(v => Number.isInteger(v) && Math.abs(v as number) < 100000)) return null;
    if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) return null;
    if ((z as number) < 0 || (z as number) > MAX_LEVEL) return null;
    out.push({ id: id as number, type, x: x as number, y: y as number, rot, z: z as number });
  }
  return out;
}
