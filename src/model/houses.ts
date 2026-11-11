import type { Mod } from './catalog.js';
import { CATALOG_HOUSES } from './catalog-houses.js';

export type Family = 'Spot' | 'SW' | 'Riga' | 'Douro' | 'Original';
export const FAMILIES: Family[] = ['Spot', 'SW', 'Riga', 'Douro', 'Original'];

/** A catalogue house split into modules. Positions in dm; ids are assigned when the house is placed. */
export interface House {
  id: string;
  family: Family;
  /** short label, e.g. "T2" */
  label: string;
  name: string;
  /** page of the plan in the TreeHouse 2025 catalogue */
  page: number;
  /** gross area as printed in the catalogue */
  catalogArea: string;
  plan: Omit<Mod, 'id'>[];
}

export const HOUSES: House[] = ([
  // Riga T2 is the default start house; all houses come from the reviewed JSON files (scripts/import-houses.py)
  ...(CATALOG_HOUSES as House[]),
] as House[]).sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || a.label.localeCompare(b.label));

export const DEFAULT_HOUSE = 'riga-t2';
export const houseById = (id: string | null | undefined) => HOUSES.find(h => h.id === id);

export function placeHouse(h: House, nextId: () => number): Mod[] {
  const mods: Mod[] = h.plan.map(({ flip: _f, ...p }) => ({ ...p, id: nextId() }));
  // in the house data, flips name the other module by its index in the plan
  h.plan.forEach((p, i) => { if (p.flip?.length) mods[i].flip = p.flip.map(j => mods[j].id); });
  return mods;
}

/** Treehouse Riga T2 (catalogue p. 37, 70 m²): the default start house. */
export const rigaT2 = (nextId: () => number) => placeHouse(houseById(DEFAULT_HOUSE)!, nextId);
