import { describe, expect, it } from 'vitest';
import type { Mod, TypeId } from '../src/model/catalog';
import { connections, doors, openingCounts, outWalls, problems, setJoin, setOut, toggleWall } from '../src/model/geometry';
import { CHOICES, fits, fitsAll, layOut, pieceOf, turnChoice, widthOf } from '../src/model/openings';
import { houseById, placeHouse } from '../src/model/houses';
import { parsePlan } from '../src/model/plan';

let id = 1;
const M = (type: TypeId, x: number, y: number, z = 0): Mod => ({ id: id++, type, x, y, rot: 0, z });

describe('outside walls', () => {
  it('a lone quarto gets one window on its longest free wall', () => {
    const q = M('quarto', 0, 0); // 28 × 35
    const ws = outWalls([q], q);
    expect(ws).toHaveLength(4);
    expect(ws.filter(w => w.kind !== 'parede').map(w => [w.side, w.kind])).toEqual([['W', 'janela']]);
  });
  it('the entrance gets its front door only on the ground floor', () => {
    const e = M('entrada', 0, 0);
    expect(outWalls([e], e).map(w => w.kind)).toContain('entrada');
    const up = M('entrada', 0, 0, 1);
    expect(outWalls([up], up).map(w => w.kind)).not.toContain('entrada');
  });
  it('walls touching another module are not outside walls', () => {
    const a = M('quarto', 0, 0), b = M('quarto', 28, 0);
    expect(outWalls([a, b], a).map(w => w.side)).not.toContain('E');
  });
  it('the user choice wins and can be cleared', () => {
    const q = M('quarto', 0, 0);
    setOut(q, 'N', 'janelaP');
    expect(outWalls([q], q).find(w => w.side === 'N')).toMatchObject({ kind: 'janelaP', chosen: true });
    setOut(q, 'N', undefined);
    expect(q.out).toBeUndefined();
  });
});

describe('shared wall choice', () => {
  it('overrides the rules and the flips, and Automático brings them back', () => {
    const a = M('quarto', 0, 0), b = M('quarto', 28, 0), h = M('entrada', 0, 35);
    expect(connections([a, b, h]).find(d => d.b === b)?.kind).toBe('parede');
    setJoin(b, a, 'porta');
    expect(connections([a, b, h]).find(d => d.b === b)).toMatchObject({ kind: 'porta', chosen: true, wall: false });
    toggleWall(a, b); // a flip does not undo an explicit choice
    expect(connections([a, b, h]).find(d => d.b === b)?.kind).toBe('porta');
    setJoin(a, b, undefined);
    expect(a.join).toBeUndefined(); expect(b.join).toBeUndefined();
    expect(connections([a, b, h]).find(d => d.b === b)?.kind).toBe('porta'); // rule wall, flipped by toggleWall
  });
  it('a window towards the deck is not a way in', () => {
    const q = M('quarto', 0, 0), d = M('deck', 0, 35), e = M('entrada', 28, 0);
    setJoin(q, d, 'janelaG');
    expect(doors([q, d, e]).some(x => x.b === d)).toBe(false);
    expect(connections([q, d, e]).find(x => x.b === d)?.kind).toBe('janelaG');
  });
  it('rules give a sliding glass door on deck walls of 2,2 m or more', () => {
    const q = M('quarto', 0, 0);
    expect(connections([q, M('deck', 0, 35)])[0].kind).toBe('correr');
    const s = M('quarto', 100, 0), dk: Mod = { id: id++, type: 'deck', x: 128, y: 0, rot: 90, z: 0 };
    expect(connections([s, dk])[0].kind).toBe('correr');
  });
});

describe('fits and pieces', () => {
  it('a wide sliding door needs a long wall', () => {
    expect(fits('correr', 2.8)).toBe(true);
    expect(fits('correr', 1.9)).toBe(false);
    expect(fits('janelaS', 2.4)).toBe(false);
    expect(pieceOf('correr', 35)).toBe('G_240');
    expect(pieceOf('correr', 25)).toBe('G_180');
  });
});

describe('access through an outside door', () => {
  it('a room with a glass door to the garden counts as a way in', () => {
    const a = M('sala', 0, 0), b = M('quarto', 38, 0);
    setJoin(a, b, 'parede');
    expect(problems([a, b]).msgs.join(' ')).toMatch(/Sem acesso/);
    setOut(b, 'E', 'vidro');
    expect(problems([a, b]).msgs.join(' ')).not.toMatch(/Quarto/);
  });
});

describe('counts and storage', () => {
  it('counts windows and doors for the quote', () => {
    const q = M('quarto', 0, 0);
    setOut(q, 'N', 'janelaP');
    expect(openingCounts([q])).toEqual(['1 × Janela pequena 0,6 m', '1 × Janela 1,2 m']);
  });
  it('keeps choices through save and load, and drops bad ones', () => {
    const p = parsePlan([{ id: 1, type: 'quarto', x: 0, y: 0, rot: 0, z: 0, join: { 2: 'porta', x: 'porta', 3: 'nope' }, out: { N: 'janela', Q: 'janela', S: 'x' } }]);
    expect(p?.[0].join).toEqual({ 2: 'porta' });
    expect(p?.[0].out).toEqual({ N: 'janela' });
  });
});

describe('several or off-centre openings in one outside wall', () => {
  it('spreads two openings evenly, or puts them where the house says', () => {
    const h = M('quarto', 0, 0); // 28 dm N wall
    setOut(h, 'N', [{ k: 'vidro' }, { k: 'janelaP' }]);
    const w = outWalls([h], h).find(x => x.side === 'N')!;
    expect(w.kind).toBe('vidro');
    expect(w.items.map(i => i.k)).toEqual(['vidro', 'janelaP']);
    expect(w.items[0].at).toBeLessThan(0); expect(w.items[1].at).toBeGreaterThan(0);
    expect(fitsAll([{ k: 'vidro' }, { k: 'janelaP' }], 28, 2.8)).toBe(true);
    expect(fitsAll([{ k: 'janelaS' }, { k: 'janelaG' }], 28, 2.8)).toBe(false);
    expect(layOut([{ k: 'janela', at: 0.5 }], 28, 2.8)).toEqual([{ k: 'janela', at: 0.5, w: 1.2 }]);
    expect(fitsAll([{ k: 'janela', at: 0.9 }], 28, 2.8)).toBe(false); // runs into the corner
    expect(fitsAll([{ k: 'janela', at: -0.6 }, { k: 'janelaP', at: 0.3 }], 28, 2.8)).toBe(false); // overlap
  });
  it('counts every opening and a front door beside a window is a way in', () => {
    const q = M('quarto', 0, 0), e = M('entrada', 28, 0);
    setOut(e, 'N', [{ k: 'entrada' }, { k: 'janelaP' }]);
    expect(openingCounts([q, e]).join()).toMatch(/1 × Porta de entrada/);
    expect(openingCounts([q, e]).join()).toMatch(/Janela pequena/);
  });
  it('turning the module keeps the openings on the same physical side', () => {
    expect(turnChoice([{ k: 'entrada', at: -1 }, { k: 'janelaP', at: 0.9 }], 'E')).toEqual([{ k: 'janelaP', at: -0.9 }, { k: 'entrada', at: 1 }]);
    expect(turnChoice([{ k: 'entrada', at: -1 }], 'N')).toEqual([{ k: 'entrada', at: -1 }]);
    expect(turnChoice('janela', 'W')).toBe('janela');
  });
  it('plans keep placed openings and drop bad ones', () => {
    const p = parsePlan([{ id: 1, type: 'quarto', x: 0, y: 0, rot: 0, z: 0, out: { N: [{ k: 'vidro', at: -0.5 }, { k: 'janelaP' }], S: [{ k: 'nada' }], W: 'janela' } }]);
    expect(p?.[0].out).toEqual({ N: [{ k: 'vidro', at: -0.5 }, { k: 'janelaP' }], W: 'janela' });
  });
  it('SW T1: front door and the WC window side by side in the hall', () => {
    const mods = placeHouse(houseById('sw-t1')!, (() => { let n = 1; return () => n++; })());
    const w = outWalls(mods, mods[2]).find(x => x.side === 'S')!;
    expect(w.items.map(i => i.k)).toEqual(['entrada', 'janelaP']);
    expect(fitsAll(mods[2].out!.S!, w.len, w.clear)).toBe(true);
  });
});

describe('solid door towards the deck and narrow doors', () => {
  it('offers a solid door towards decks and outside', () => {
    expect(CHOICES.deck).toContain('portaExt');
    expect(CHOICES.outside).toContain('portaExt');
  });
  it('Spot T1B: the WC + storage opens to the deck with a solid door', () => {
    const mods = placeHouse(houseById('spot-t1b')!, (() => { let n = 1; return () => n++; })());
    expect(connections(mods).find(d => d.a === mods[2] && d.b === mods[3])?.kind).toBe('portaExt');
    expect(problems(mods).msgs.join()).not.toMatch(/Sem acesso/);
  });
  it('a door fits a 1,1 m wall, narrowed to 0,7 m', () => {
    expect(fits('vidro', 1.1)).toBe(true);
    expect(fits('porta', 1.1)).toBe(true);
    expect(widthOf('vidro', 11)).toBe(0.7);
    expect(widthOf('vidro', 35)).toBe(0.9);
    expect(fits('vidro', 1.0)).toBe(false);
    expect(fits('janela', 1.1)).toBe(false);
    for (const id of ['original-t2c', 'original-t3b']) {
      const mods = placeHouse(houseById(id)!, (() => { let n = 1; return () => n++; })());
      const a = mods.find(m => m.type === 'antecamaraE')!;
      expect(outWalls(mods, a).find(w => w.side === 'N')?.items.map(i => [i.k, i.w])).toEqual([['vidro', 0.7]]);
    }
  });
});
