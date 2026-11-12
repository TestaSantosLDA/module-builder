import { describe, expect, it } from 'vitest';
import { contactGrid } from '../src/ui/contact';

const at = (g: ReturnType<typeof contactGrid>, x: number, z: number) => g.a[Math.floor((g.z1 - z) * g.ppm) * g.w + Math.floor((x - g.x0) * g.ppm)];

describe('contact shadows', () => {
  const g = contactGrid([{ x: 0, y: 0, w: 40, h: 30 }], { margin: 3, blur: 0.5, strength: 0.6, grow: 0.1 });
  it('covers the footprint plus the margin', () => {
    expect(g.x0).toBeCloseTo(-3); expect(g.x1).toBeCloseTo(7); expect(g.z0).toBeCloseTo(-3); expect(g.z1).toBeCloseTo(6);
  });
  it('is darkest under the module and fades to nothing a metre away', () => {
    expect(at(g, 2, 1.5)).toBeCloseTo(0.6, 2);
    expect(at(g, 4.1, 1.5)).toBeGreaterThan(0.15);
    expect(at(g, 5.5, 1.5)).toBeLessThan(0.01);
  });
  it('rows run from the far edge (z1) so a rotated plane shows it the right way round', () => {
    const h = contactGrid([{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 50, w: 10, h: 10 }], { margin: 1, blur: 0.2, strength: 1, grow: 0 });
    expect(at(h, 0.5, 0.5)).toBeGreaterThan(0.9);
    expect(at(h, 0.5, 3)).toBeLessThan(0.05);
    expect(h.a[Math.floor(1.5 * h.ppm) * h.w + Math.floor(1.5 * h.ppm)]).toBeGreaterThan(0.9); // 1.5 m from the top row = z 5.5 (the second module)
  });
});
