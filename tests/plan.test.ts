import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/model/plan';

describe('parsePlan', () => {
  it('accepts a valid plan', () => {
    expect(parsePlan([{ id: 1, type: 'sala', x: 0, y: 0, rot: 90, z: 1 }])).toHaveLength(1);
  });
  it('rejects unknown types, bad rotations and levels', () => {
    expect(parsePlan([{ id: 1, type: 'castelo', x: 0, y: 0, rot: 0, z: 0 }])).toBeNull();
    expect(parsePlan([{ id: 1, type: 'sala', x: 0, y: 0, rot: 45, z: 0 }])).toBeNull();
    expect(parsePlan([{ id: 1, type: 'sala', x: 0, y: 0, rot: 0, z: 3 }])).toBeNull();
    expect(parsePlan({})).toBeNull();
  });
  it('rejects oversized plans', () => {
    expect(parsePlan(Array.from({ length: 61 }, (_, i) => ({ id: i, type: 'deck', x: 0, y: 0, rot: 0, z: 0 })))).toBeNull();
  });
});
