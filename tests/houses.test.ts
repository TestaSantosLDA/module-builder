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
