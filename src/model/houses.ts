import type { Mod, TypeId } from './catalog';

/** Treehouse Riga T2 (catalogue p. 37, 70 m²) split into its pieces. Positions in dm. */
export function rigaT2(nextId: () => number): Mod[] {
  const P = (type: TypeId, x: number, y: number): Mod => ({ id: nextId(), type, x, y, rot: 0, z: 0 });
  return [
    P('deck', 0, 0), P('entrada', 28, 0), P('quarto', 66, 0),
    P('cozinha', 0, 35), P('sala', 28, 35), P('deck', 66, 35),
    P('deckL', -9, 70), P('suite', 28, 70), P('quarto', 66, 70),
  ];
}
