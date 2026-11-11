import type { Mod, TypeId } from './catalog.js';
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

const P = (type: TypeId, x: number, y: number, rot: Mod['rot'] = 0, z = 0): Omit<Mod, 'id'> => ({ type, x, y, rot, z });

export const HOUSES: House[] = ([
  {
    id: 'riga-t2', family: 'Riga', label: 'T2', name: 'Treehouse Riga T2', page: 37, catalogArea: '70 m²',
    plan: [
      P('deck', 0, 0), P('entrada', 28, 0), P('quarto', 66, 0),
      P('cozinha', 0, 35), P('sala', 28, 35), P('deck', 66, 35),
      P('deckL', -9, 70), P('suite', 28, 70), P('quarto', 66, 70),
    ],
  },
  ...(CATALOG_HOUSES as House[]),
] as House[]).sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || a.label.localeCompare(b.label));

export const DEFAULT_HOUSE = 'riga-t2';
export const houseById = (id: string | null | undefined) => HOUSES.find(h => h.id === id);

export function placeHouse(h: House, nextId: () => number): Mod[] {
  return h.plan.map(p => ({ ...p, id: nextId() }));
}

/** Treehouse Riga T2 (catalogue p. 37, 70 m²): the default start house. */
export const rigaT2 = (nextId: () => number) => placeHouse(houseById(DEFAULT_HOUSE)!, nextId);
