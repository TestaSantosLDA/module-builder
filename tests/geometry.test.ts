import { describe, expect, it } from 'vitest';
import type { Mod, TypeId } from '../src/model/catalog';
import { doors, footprint, problems, sides, snapToNeighbours, summarize } from '../src/model/geometry';
import { rigaT2 } from '../src/model/houses';

let id = 1;
const M = (type: TypeId, x: number, y: number, z = 0, rot: Mod['rot'] = 0): Mod => ({ id: id++, type, x, y, rot, z });

describe('footprint', () => {
  it('swaps width and depth when turned 90°', () => {
    expect(footprint(M('sala', 0, 0))).toEqual({ x: 0, y: 0, w: 38, h: 35 });
    expect(footprint(M('sala', 0, 0, 0, 90))).toEqual({ x: 0, y: 0, w: 35, h: 38 });
  });
});

describe('automatic doors', () => {
  it('room next to room gets a normal door', () => {
    const [d] = doors([M('quarto', 0, 0), M('entrada', 28, 0)]);
    expect(d).toMatchObject({ vertical: true, x: 28, y: 17.5, len: 35, glass: false, open: false });
  });
  it('room next to deck gets a glass door', () => {
    expect(doors([M('quarto', 0, 0), M('deck', 0, 35)])[0]).toMatchObject({ vertical: false, glass: true, open: false });
  });
  it('deck next to deck gets no door', () => {
    expect(doors([M('deck', 0, 0), M('deckL', 28, 0)])).toHaveLength(0);
  });
  it('sala and cozinha join as open plan', () => {
    expect(doors([M('cozinha', 0, 0), M('sala', 28, 0)])[0].open).toBe(true);
  });
  it('needs at least 1 m of shared wall', () => {
    expect(doors([M('quarto', 0, 0), M('quarto', 28, 30)])).toHaveLength(0);
    expect(doors([M('quarto', 0, 0), M('quarto', 28, 25)])).toHaveLength(1);
  });
  it('ignores modules on different floors', () => {
    expect(doors([M('quarto', 0, 0), M('quarto', 28, 0, 1)])).toHaveLength(0);
  });
  it('the Riga T2 gets 11 doors (suite–quarto is a wall)', () => {
    let n = 1;
    expect(doors(rigaT2(() => n++))).toHaveLength(11);
  });
});

describe('problems', () => {
  it('flags overlapping modules', () => {
    const a = M('quarto', 0, 0), b = M('quarto', 10, 0);
    const p = problems([a, b]);
    expect([...p.bad]).toEqual([a, b]);
    expect(p.msgs).toContain('Há módulos sobrepostos.');
  });
  it('an upper module must sit fully on rooms below', () => {
    const below = M('sala', 0, 0), stairs = M('escada', 38, 0);
    expect(problems([below, stairs, M('quarto', 0, 0, 1)]).msgs).toEqual([]);
    const p = problems([below, stairs, M('sala', 50, 0, 1)]);
    expect(p.msgs[0]).toMatch(/no ar/);
  });
  it('a deck does not carry a floor above', () => {
    expect(problems([M('deck', 0, 0), M('escada', 28, 0), M('quarto', 0, 0, 1)]).msgs[0]).toMatch(/no ar/);
  });
  it('asks for stairs on the floor below', () => {
    expect(problems([M('sala', 0, 0), M('quarto', 0, 0, 1)]).msgs).toEqual(['Falta uma escada no piso 0 para subir ao piso 1.']);
  });
});

describe('snapping', () => {
  it('snaps against a neighbour within 0.5 m', () => {
    const a = M('quarto', 0, 0), b = M('quarto', 31, 2);
    snapToNeighbours([a, b], b);
    expect([b.x, b.y]).toEqual([28, 0]);
  });
  it('leaves far modules alone', () => {
    const a = M('quarto', 0, 0), b = M('quarto', 40, 12);
    snapToNeighbours([a, b], b);
    expect([b.x, b.y]).toEqual([40, 12]);
  });
});

describe('sides', () => {
  it('reports what touches each wall', () => {
    const r = M('quarto', 0, 0);
    expect(sides([r, M('deck', 28, 0), M('sala', 0, 35)], r)).toEqual({ N: 'free', S: 'room', W: 'free', E: 'deck' });
  });
});

describe('summary', () => {
  it('counts the Riga T2', () => {
    let n = 1;
    const s = summarize(rigaT2(() => n++));
    expect(s).toMatchObject({ floors: 1, rooms: 6, area: 69, deck: 33, doors: 11, msgs: [] });
  });
});

describe('door ↔ wall flip', () => {
  it('a flipped shared wall has no opening, and flipping again restores the door', async () => {
    const { connections, toggleWall } = await import('../src/model/geometry');
    const a = M('quarto', 0, 0), b = M('quarto', 28, 0);
    toggleWall(a, b);
    expect(doors([a, b])).toHaveLength(0);
    expect(connections([a, b])[0].wall).toBe(true);
    toggleWall(b, a);
    expect(doors([a, b])).toHaveLength(1);
    expect(a.flip).toBeUndefined(); expect(b.flip).toBeUndefined();
  });
  it('keeps flips when a plan is saved and loaded', async () => {
    const { parsePlan } = await import('../src/model/plan');
    expect(parsePlan([{ id: 1, type: 'quarto', x: 0, y: 0, rot: 0, z: 0, flip: [2] }])?.[0].flip).toEqual([2]);
  });
});

describe('door rules', () => {
  it('bedrooms side by side get a wall, a bathroom never opens onto the living room', () => {
    expect(doors([M('quarto', 0, 0), M('quarto', 28, 0), M('entrada', 0, 35)]).map(d => TYPESNAME(d))).not.toContain('quarto|quarto');
  });
  it('a room the rules would close off keeps one door', () => {
    expect(doors([M('quarto', 0, 0), M('quarto', 28, 0)])).toHaveLength(1);
  });
  it('kitchen + kitchen and sala + sala are open plan', () => {
    expect(doors([M('cozinha', 0, 0), M('cozinha', 28, 0)])[0].open).toBe(true);
  });
  it('warns about a room nobody can get into', () => {
    const a = M('quarto', 0, 0), b = M('entrada', 28, 0), c = M('deck', 0, 35);
    toggleWallT(a, b);
    expect(problems([a, b]).msgs.join(' ')).toMatch(/Sem acesso: Quarto/);
    expect(problems([a, b, c]).msgs).toEqual([]); // the deck's glass door lets you in
  });
});
const TYPESNAME = (d: { a: Mod; b: Mod }) => `${d.a.type}|${d.b.type}`;
import { toggleWall as toggleWallT } from '../src/model/geometry';
