// What each wall can have: plain wall, door, open plan or one of the windows and glass doors of the Blender kit.
import { TYPES, type Mod, type TypeId } from './catalog.js';

export type Dir = 'N' | 'S' | 'W' | 'E';
export const DIRS: Dir[] = ['N', 'S', 'W', 'E'];

export type Opening =
  | 'parede' | 'porta' | 'aberto'
  | 'janelaP' | 'janela' | 'janelaG' | 'janelaS'
  | 'vidro' | 'correr' | 'entrada' | 'portaExt'
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
  // solid outside door (I.S., arrumos): the front door of the kit at 0.9 m
  portaExt: { name: 'Porta cheia 0,9 m', w: 0.9, h: 2.1, sill: 0, pass: true, piece: 'D_entrada' },
  janelaC: { name: 'Janela de cozinha 1,4 m', w: 1.4, h: 1.0, sill: 1.05, pass: false, piece: 'W_cozinha' },
  janelaL: { name: 'Janela 1,4 m', w: 1.4, h: 1.4, sill: 0.8, pass: false, piece: 'W_livre' },
  janelaE: { name: 'Janela de escada', w: 0.5, h: 2.0, sill: 0.4, pass: false, piece: 'W_escada' },
};

/** Single doors that get narrower on short walls (down to 0.7 m), like the narrow antechambers of the Original houses. */
const NARROWS: Opening[] = ['porta', 'vidro', 'portaExt'];
const MIN_DOOR = 0.7;

/** Kit piece for an opening on a wall `len` dm long (wide sliding door on long walls). */
export const pieceOf = (k: Opening, len: number): string | undefined => (k === 'correr' && len >= 29 ? 'G_240' : OPENINGS[k].piece);
/** Opening width on a wall `len` dm long, m: a single door takes what the wall has left after 0.2 m at each end. */
export const widthOf = (k: Opening, len: number): number =>
  k === 'aberto' ? len / 10 - 0.3 : k === 'correr' && len >= 29 ? 2.4
    : NARROWS.includes(k) ? Math.max(MIN_DOOR, Math.min(OPENINGS[k].w, Math.round((len / 10 - 0.4) * 100) / 100)) : OPENINGS[k].w;

/** Menu choices, by what is on the other side of the wall. */
export const CHOICES: Record<'room' | 'deck' | 'outside' | 'outsideUp', Opening[]> = {
  room: ['parede', 'porta', 'aberto'],
  deck: ['parede', 'janelaP', 'janela', 'janelaG', 'janelaS', 'vidro', 'correr', 'portaExt'],
  outside: ['parede', 'janelaP', 'janela', 'janelaG', 'janelaS', 'vidro', 'correr', 'entrada', 'portaExt'],
  outsideUp: ['parede', 'janelaP', 'janela', 'janelaG'],
};

/** Does this opening fit a wall of `clear` metres (the free length between corner posts)? */
export const fits = (k: Opening, clear: number): boolean => k === 'parede' || k === 'aberto' || widthOf(k, clear * 10) <= clear - 0.4;

/** What can go beside another opening in the same outside wall. */
export const BESIDE: Opening[] = ['janelaP', 'janela', 'janelaG', 'vidro', 'entrada', 'portaExt'];

/**
 * One opening placed along a wall. `at` is the centre, in metres from the middle of the wall, towards +x (east) on N/S walls
 * and +y (south) on W/E walls; without it the openings of a wall are spread evenly.
 */
export interface Placed { k: Opening; at?: number }
/** An outside wall holds one opening (centred) or a list of placed ones. */
export type OutChoice = Opening | Placed[];
export const MAX_PER_WALL = 3;
/** Free wall kept at each end and between two openings, m. */
const EDGE = 0.2, GAP = 0.2;

export interface Laid { k: Opening; at: number; w: number }

/** The openings of a choice, without plain walls. */
export const itemsOf = (c: OutChoice): Placed[] => (typeof c === 'string' ? (c === 'parede' ? [] : [{ k: c }]) : c.filter(p => p.k !== 'parede'));

/** Where each opening goes on a wall `len` dm long with `clear` metres free: given positions, or spread evenly. */
export function layOut(c: OutChoice, len: number, clear: number): Laid[] {
  const it = itemsOf(c), ws = it.map(p => widthOf(p.k, len));
  if (it.every(p => p.at !== undefined)) return it.map((p, i) => ({ k: p.k, at: p.at!, w: ws[i] }));
  const gap = Math.max(GAP, (clear - ws.reduce((a, b) => a + b, 0)) / (it.length + 1));
  let x = -clear / 2 + gap;
  return it.map((p, i) => { const l = { k: p.k, at: Math.round((x + ws[i] / 2) * 100) / 100, w: ws[i] }; x += ws[i] + gap; return l; });
}

/** Do these openings fit a wall with `clear` metres free, keeping 0.2 m at the ends and between them? */
export function fitsAll(c: OutChoice, len: number, clear: number): boolean {
  const l = layOut(c, len, clear).sort((a, b) => a.at - b.at);
  if (l.length > MAX_PER_WALL) return false;
  if (l.length === 1 && l[0].k === 'aberto') return true;
  if (l.some(p => p.k === 'aberto')) return false;
  const e = 1e-6;
  for (let i = 0; i < l.length; i++) {
    const a = l[i].at - l[i].w / 2, b = l[i].at + l[i].w / 2;
    if (a < -clear / 2 + EDGE - e || b > clear / 2 - EDGE + e) return false;
    if (i && a < l[i - 1].at + l[i - 1].w / 2 + GAP - e) return false;
  }
  return true;
}

/** Turning a module a quarter turn clockwise: N→E and S→W keep the direction along the wall, E→S and W→N reverse it. */
export function turnChoice(c: OutChoice, from: Dir): OutChoice {
  if (typeof c === 'string' || from === 'N' || from === 'S') return c;
  return c.map(p => (p.at === undefined ? { ...p } : { k: p.k, at: -p.at })).reverse();
}

export const isPlaced = (v: unknown): v is Placed => {
  if (!v || typeof v !== 'object') return false;
  const { k, at } = v as Record<string, unknown>;
  return isOpening(k) && (at === undefined || (typeof at === 'number' && Number.isFinite(at) && Math.abs(at) < 50));
};
export const isOutChoice = (v: unknown): v is OutChoice =>
  isOpening(v) || (Array.isArray(v) && v.length >= 1 && v.length <= MAX_PER_WALL && v.every(isPlaced));

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
