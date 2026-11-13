import { describe, expect, it } from 'vitest';
import { readFx } from '../src/fx/quality';

describe('quality tiers', () => {
  it('desktop gets the full tier with every effect', () => {
    const fx = readFx('', false, 1440, 900);
    expect(fx).toMatchObject({ on: true, tier: 'alto', ao: true, sky: true, look: true, contact: true, bloom: true, smaa: true, trees: false, world: false, furniture: true, maxPixelRatio: 2 });
    expect(readFx('?fx=mundo', false, 1440, 900)).toMatchObject({ sky: true, world: true, trees: true });
    expect(readFx('?fx=mundo,nosky', false, 1440, 900)).toMatchObject({ world: false, trees: false });
  });
  it('touch screens get the light tier without screen-space AO', () => {
    const fx = readFx('', true, 1180, 820);
    expect(fx).toMatchObject({ tier: 'leve', ao: false, bloom: false, smaa: false, trees: false, sky: true, contact: true, maxPixelRatio: 1.5, shadowMapSize: 1024 });
  });
  it('small windows also get the light tier', () => expect(readFx('', false, 700, 900).tier).toBe('leve'));
  it('?fx=0 turns everything off', () => expect(readFx('?fx=0', false, 1440, 900)).toMatchObject({ on: false, ao: false, sky: false, look: false, contact: false }));
  it('forces a tier and single effects off', () => {
    expect(readFx('?fx=alto', true, 400, 800)).toMatchObject({ tier: 'alto', ao: true });
    expect(readFx('?fx=leve,nosky', false, 1440, 900)).toMatchObject({ tier: 'leve', sky: false, look: true });
    expect(readFx('?fx=noao,nolook', false, 1440, 900)).toMatchObject({ ao: false, look: false, sky: true });
    expect(readFx('?fx=nobloom,nosmaa,notrees', false, 1440, 900)).toMatchObject({ bloom: false, smaa: false, trees: false, ao: true, furniture: true });
    expect(readFx('?fx=nomob', false, 1440, 900).furniture).toBe(false);
    expect(readFx('?fx=0', false, 1440, 900).furniture).toBe(false);
  });
});
