import { describe, expect, it } from 'vitest';
import { readFx } from '../src/fx/quality';

describe('quality tiers', () => {
  it('desktop gets the full tier with every effect', () => {
    const fx = readFx('', false, 1440, 900);
    expect(fx).toMatchObject({ on: true, tier: 'alto', ao: true, sky: true, look: true, contact: true, maxPixelRatio: 2 });
  });
  it('touch screens get the light tier without screen-space AO', () => {
    const fx = readFx('', true, 1180, 820);
    expect(fx).toMatchObject({ tier: 'leve', ao: false, sky: true, contact: true, maxPixelRatio: 1.5, shadowMapSize: 1024 });
  });
  it('small windows also get the light tier', () => expect(readFx('', false, 700, 900).tier).toBe('leve'));
  it('?fx=0 turns everything off', () => expect(readFx('?fx=0', false, 1440, 900)).toMatchObject({ on: false, ao: false, sky: false, look: false, contact: false }));
  it('forces a tier and single effects off', () => {
    expect(readFx('?fx=alto', true, 400, 800)).toMatchObject({ tier: 'alto', ao: true });
    expect(readFx('?fx=leve,nosky', false, 1440, 900)).toMatchObject({ tier: 'leve', sky: false, look: true });
    expect(readFx('?fx=noao,nolook', false, 1440, 900)).toMatchObject({ ao: false, look: false, sky: true });
  });
});
