// What each wall can have: plain wall, door, open plan or one of the windows and glass doors of the Blender kit.
import { TYPES, type Mod, type TypeId } from './catalog.js';

export type Dir = 'N' | 'S' | 'W' | 'E';
export const DIRS: Dir[] = ['N', 'S', 'W', 'E'];

export type Opening =
  | 'parede' | 'porta' | 'aberto'
  | 'janelaP' | 'janela' | 'janelaG' | 'janelaS'
  | 'vidro' | 'correr' | 'entrada'
  // only used as defaults for some rooms, not offered in the menu
  | 'janelaC' | 'janelaL' | 'janelaE';

export interface OpeningSpec {
  name: string;
  /** opening width and height, m (aberto: the whole wall) */
  w: number;
  h: number;
  /** sill height above the floor, m */
  sill: number;
  /** people walk through it */
  pass: boolean;
  /** Blender kit piece; correr picks G_240 on long walls */
  piece?: string;
}

export const OPENINGS: Record<Opening, OpeningSpec> = {
  parede: { name: 'Parede cheia', w: 0, h: 0, sill: 0, pass: false },
  porta: { name: 'Porta', w: 0.9, h: 2.1, sill: 0, pass: true },
  aberto: { name: 'Sem parede (vão aberto)', w: 0, h: 0, sill: 0, pass: true },
  janelaP: { name: 'Janela pequena 0,6 m', w: 0.6, h: 0.6, sill: 1.6, pass: false, piece: 'W_wc' },
  janela: { name: 'Janela 1,2 m', w: 1.2, h: 1.2, sill: 0.9, pass: false, piece: 'W_quarto' },
  janelaG: { name: 'Janela grande 1,6 m', w: 1.6, h: 1.6, sill: 0.7, pass: false, piece: 'W_sala2' },
  janelaS: { name: 'Janela até ao chão 2,4 m', w: 2.4, h: 2.2, sill: 0.2, pass: false, piece: 'W_sala' },
  vidro: { name: 'Porta de vidro 0,9 m', w: 0.9, h: 2.3, sill: 0, pass: true, piece: 'G_090' },
  correr: { name: 'Porta de vidro dupla de correr', w: 1.8, h: 2.3, sill: 0, pass: true, piece: 'G_180' },
  entrada: { name: 'Porta de entrada', w: 1.0, h: 2.2, sill: 0, pass: true, piece: 'D_entrada' },
  janelaC: { name: 'Janela de cozinha 1,4 m', w: 1.4, h: 1.0, sill: 1.05, pass: false, piece: 'W_cozinha' },
  janelaL: { name: 'Janela 1,4 m', w: 1.4, h: 1.4, sill: 0.8, pass: false, piece: 'W_livre' },
  janelaE: { name: 'Janela de escada', w: 0.5, h: 2.0, sill: 0.4, pass: false, piece: 'W_escada' },
};

/** Kit piece for an opening on a wall `len` dm long (wide sliding door on long walls). */
export const pieceOf = (k: Opening, len: number): string | undefined => (k === 'correr' && len >= 29 ? 'G_240' : OPENINGS[k].piece);
/** Opening width on a wall `len` dm long, m. */
export const widthOf = (k: Opening, len: number): number => (k === 'aberto' ? len / 10 - 0.3 : k === 'correr' && len >= 29 ? 2.4 : OPENINGS[k].w);

/** Menu choices, by what is on the other side of the wall. */
export const CHOICES: Record<'room' | 'deck' | 'outside' | 'outsideUp', Opening[]> = {
  room: ['parede', 'porta', 'aberto'],
  deck: ['parede', 'janelaP', 'janela', 'janelaG', 'janelaS', 'vidro', 'correr'],
  outside: ['parede', 'janelaP', 'janela', 'janelaG', 'janelaS', 'vidro', 'correr', 'entrada'],
  outsideUp: ['parede', 'janelaP', 'janela', 'janelaG'],
};

/** Does this opening fit a wall of `clear` metres (the free length between corner posts)? */
export const fits = (k: Opening, clear: number): boolean => k === 'parede' || k === 'aberto' || widthOf(k, clear * 10) <= clear - 0.4;

/** Default outside openings per room sketch, longest free wall first. */
const UNIT: Record<string, Opening[]> = {
  sala: ['janelaS', 'janelaG'], cozinha: ['janelaC'], entrada: ['entrada', 'janelaP'],
  quarto: ['janela'], suite: ['janela', 'janelaP'], livre: ['janelaL'], escada: ['janelaE'],
};
export function defaultOutside(m: Mod): Opening[] {
  const t: TypeId = m.type, s = TYPES[t].sketch ?? 'livre';
  const spec = (UNIT[s] ?? UNIT.livre).slice();
  if (spec[0] === 'entrada' && m.z) spec.shift(); // no front door upstairs
  return spec;
}

export const isOpening = (v: unknown): v is Opening => typeof v === 'string' && Object.prototype.hasOwnProperty.call(OPENINGS, v);

/** Rotating a module a quarter turn clockwise moves its outside choices with it. */
export const TURN: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };
