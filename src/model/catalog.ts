// Module catalogue. Units are decimetres (1 unit = 10 cm).
// Sizes are PROVISIONAL: estimated from the Riga T2 plan (catalogue p. 37) until Jular sends real dimensions.

import { EXTRA_TYPES } from './catalog-houses.js';

export type Kind = 'room' | 'deck';
/** Palette group. */
export type Category = 'sala' | 'quarto' | 'wc' | 'circ' | 'deck' | 'escada';
export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'sala', name: 'Salas e cozinhas' }, { id: 'quarto', name: 'Quartos' }, { id: 'wc', name: 'Casas de banho e entradas' },
  { id: 'circ', name: 'Circulação e outros' }, { id: 'deck', name: 'Decks' }, { id: 'escada', name: 'Escadas' },
];
/** Base types whose plan sketch other types can reuse. */
export type SketchId = 'sala' | 'cozinha' | 'entrada' | 'quarto' | 'suite' | 'escada' | 'deck';

export interface ModuleType {
  name: string;
  /** width along x before rotation, in dm */
  w: number;
  /** depth along y before rotation, in dm */
  h: number;
  kind: Kind;
  cat: Category;
  /** furniture sketch drawn on the plan (defaults to none) */
  sketch?: SketchId;
  stairs?: boolean;
}

const BASE_TYPES = {
  sala: { name: 'Sala', w: 38, h: 35, kind: 'room', cat: 'sala', sketch: 'sala' },
  cozinha: { name: 'Cozinha', w: 28, h: 35, kind: 'room', cat: 'sala', sketch: 'cozinha' },
  entrada: { name: 'Entrada + WC', w: 38, h: 35, kind: 'room', cat: 'wc', sketch: 'entrada' },
  quarto: { name: 'Quarto', w: 28, h: 35, kind: 'room', cat: 'quarto', sketch: 'quarto' },
  suite: { name: 'Quarto opcional + WC', w: 38, h: 35, kind: 'room', cat: 'quarto', sketch: 'suite' },
  livre: { name: 'Módulo livre', w: 38, h: 35, kind: 'room', cat: 'circ' },
  escada: { name: 'Escadas', w: 28, h: 35, kind: 'room', cat: 'escada', sketch: 'escada', stairs: true },
  deck: { name: 'Deck', w: 28, h: 35, kind: 'deck', cat: 'deck', sketch: 'deck' },
  deckL: { name: 'Deck grande', w: 37, h: 35, kind: 'deck', cat: 'deck', sketch: 'deck' },
} as const satisfies Record<string, ModuleType>;

/** Base modules plus the ones found in the catalogue houses (src/model/catalog-houses.ts). */
export const TYPES: Record<Extract<keyof typeof BASE_TYPES | keyof typeof EXTRA_TYPES, string>, ModuleType> = { ...BASE_TYPES, ...EXTRA_TYPES };

export type TypeId = keyof typeof TYPES;

export const isTypeId = (t: unknown): t is TypeId => typeof t === 'string' && Object.prototype.hasOwnProperty.call(TYPES, t);

/** A kitchen next to a living room joins as open plan: no wall, no door. */
export const isOpenPlan = (a: TypeId, b: TypeId): boolean => {
  const sa = TYPES[a].sketch, sb = TYPES[b].sketch;
  return (sa === 'cozinha' && sb === 'sala') || (sa === 'sala' && sb === 'cozinha');
};

/** Storey height in dm. */
export const STOREY = 30;
/** Highest level index (0 = ground floor), so 3 floors in total. */
export const MAX_LEVEL = 2;
/** Shortest shared wall (dm) that gets a door. */
export const MIN_DOOR_WALL = 10;

/** One placed module. x/y is the top-left corner of the rotated footprint, z the level. */
export interface Mod {
  id: number;
  type: TypeId;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
  z: number;
}
