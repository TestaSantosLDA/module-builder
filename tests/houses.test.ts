import { describe, expect, it } from 'vitest';
import { TYPES } from '../src/model/catalog';
import { problems } from '../src/model/geometry';
import { HOUSES, placeHouse } from '../src/model/houses';
import { parsePlan } from '../src/model/plan';

describe('catalogue houses', () => {
  it('have unique ids', () => {
    expect(new Set(HOUSES.map(h => h.id)).size).toBe(HOUSES.length);
  });
  for (const h of HOUSES) {
    it(`${h.name} is a valid plan with no warnings`, () => {
      let n = 1;
      const mods = placeHouse(h, () => n++);
      expect(parsePlan(mods)).not.toBeNull();
      for (const m of mods) expect(TYPES[m.type]).toBeDefined();
      expect(problems(mods).msgs).toEqual([]);
    });
  }
});

describe('placeHouse', () => {
  it('maps join indices to module ids and copies outside walls', () => {
    const h = { ...HOUSES[0], plan: [
      { type: 'entrada', x: 0, y: 0, rot: 0, z: 0, out: { N: 'janelaP' }, join: { 1: 'aberto' } },
      { type: 'quarto', x: 38, y: 0, rot: 0, z: 0 },
    ] } as typeof HOUSES[0];
    let n = 10;
    const mods = placeHouse(h, () => n++);
    expect(mods[0].join).toEqual({ 11: 'aberto' });
    expect(mods[0].out).toEqual({ N: 'janelaP' });
    expect(mods[0].out).not.toBe(h.plan[0].out);
  });
});
