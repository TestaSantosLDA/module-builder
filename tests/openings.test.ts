import { describe, expect, it } from 'vitest';
import type { Mod, TypeId } from '../src/model/catalog';
import { connections, doors, openingCounts, outWalls, problems, setJoin, setOut, toggleWall } from '../src/model/geometry';
import { fits, pieceOf } from '../src/model/openings';
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
