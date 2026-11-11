// Module catalogue. Units are decimetres (1 unit = 10 cm).
// Sizes are PROVISIONAL: estimated from the Riga T2 plan (catalogue p. 37) until Jular sends real dimensions.

export type Kind = 'room' | 'deck';

export interface ModuleType {
  name: string;
  /** width along x before rotation, in dm */
  w: number;
  /** depth along y before rotation, in dm */
  h: number;
  kind: Kind;
  stairs?: boolean;
}

export const TYPES = {
  sala: { name: 'Sala', w: 38, h: 35, kind: 'room' },
  cozinha: { name: 'Cozinha', w: 28, h: 35, kind: 'room' },
  entrada: { name: 'Entrada + WC', w: 38, h: 35, kind: 'room' },
  quarto: { name: 'Quarto', w: 28, h: 35, kind: 'room' },
  suite: { name: 'Quarto opcional + WC', w: 38, h: 35, kind: 'room' },
  livre: { name: 'Módulo livre', w: 38, h: 35, kind: 'room' },
  escada: { name: 'Escadas', w: 28, h: 35, kind: 'room', stairs: true },
  deck: { name: 'Deck', w: 28, h: 35, kind: 'deck' },
  deckL: { name: 'Deck grande', w: 37, h: 35, kind: 'deck' },
} as const satisfies Record<string, ModuleType>;

export type TypeId = keyof typeof TYPES;

export const isTypeId = (t: unknown): t is TypeId => typeof t === 'string' && Object.prototype.hasOwnProperty.call(TYPES, t);

/** Pairs that join as open plan: no wall, no door. */
export const OPEN_PLAN = new Set(['cozinha|sala', 'sala|cozinha']);

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
