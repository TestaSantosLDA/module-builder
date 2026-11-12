// Quality tiers and effect switches, read from the URL. Same flags as the apartment walkthrough (web/viewer.js):
//   ?fx=0                 everything off (the 3D as before: studio light, paper background, no post-processing)
//   ?fx=leve | ?fx=alto   force a tier (default: phones/tablets and small screens get "leve")
//   ?fx=noao,nosky,nolook,nocontact,nobloom,nosmaa,notrees,nomob   turn single effects off (comma-separated)
export type Tier = 'leve' | 'alto';
export interface Fx {
  on: boolean;
  tier: Tier;
  /** screen-space ambient occlusion (GTAO): desktop tier only */
  ao: boolean;
  /** HDRI sky, sky light and grass ground */
  sky: boolean;
  /** AgX "photo look" contrast + vignette */
  look: boolean;
  /** baked per-module AO and contact shadows (cheap, every tier) */
  contact: boolean;
  /** soft glow around very bright light (sun glints, lit windows): desktop tier only */
  bloom: boolean;
  /** SMAA on top of MSAA, for edges inside textures and thin lines: desktop tier only */
  smaa: boolean;
  /** billboard trees and shrubs around the house: desktop tier only */
  trees: boolean;
  /** furniture and interior doors from the Blender web kit (public/kit/mobilia); real textures on them in the desktop tier only */
  furniture: boolean;
  /** device pixel ratio cap */
  maxPixelRatio: number;
  shadowMapSize: number;
}

export function readFx(search: string, coarsePointer: boolean, width: number, height: number): Fx {
  const args = new Set((new URLSearchParams(search).get('fx') || '').split(',').map(s => s.trim()).filter(Boolean));
  const on = !args.has('0');
  const tier: Tier = args.has('leve') ? 'leve' : args.has('alto') ? 'alto' : coarsePointer || Math.min(width, height * 2) < 900 ? 'leve' : 'alto';
  return {
    on, tier,
    ao: on && tier === 'alto' && !args.has('noao'),
    sky: on && !args.has('nosky'),
    look: on && !args.has('nolook'),
    contact: on && !args.has('nocontact'),
    bloom: on && tier === 'alto' && !args.has('nobloom'),
    smaa: on && tier === 'alto' && !args.has('nosmaa'),
    trees: on && tier === 'alto' && !args.has('nosky') && !args.has('notrees'),
    furniture: on && !args.has('nomob'),
    maxPixelRatio: tier === 'leve' ? 1.5 : 2,
    shadowMapSize: tier === 'leve' ? 1024 : 2048,
  };
}

export const browserFx = (): Fx =>
  readFx(location.search, typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, innerWidth, innerHeight);
