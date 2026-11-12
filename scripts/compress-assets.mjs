// Turns the sources in assets/ into what the site downloads, in public/ (shared with the apartment walkthrough):
//   textures -> KTX2 (Basis Universal): about 4-6x less GPU memory than JPG/PNG, and smaller downloads;
//   (flipped vertically like three's TextureLoader does with JPG/PNG, so UVs and normal maps keep their sense)
//   models   -> glTF with EXT_meshopt_compression + quantized vertices.
//   node scripts/compress-assets.mjs            (only what changed: compares mtimes)
//   node scripts/compress-assets.mjs --all
// The list of assets and how each is encoded is assets/assets.json.
import { readFile, writeFile, mkdir, stat, copyFile, readdir } from 'node:fs/promises';
import { dirname, join, extname, basename } from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, quantize, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = new URL('..', import.meta.url).pathname, SRC = join(ROOT, 'assets'), OUT = join(ROOT, 'public');
const all = process.argv.includes('--all');
const manifest = JSON.parse(await readFile(join(SRC, 'assets.json'), 'utf8'));

const decode = async buf => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
const OPTS = {
  color: { isUASTC: false, qualityLevel: 230, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  data: { isUASTC: false, qualityLevel: 200, compressionLevel: 2, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  normal: { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 1, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};
const mtime = async p => { try { return (await stat(p)).mtimeMs; } catch { return 0; } };
const fresh = async (src, dst) => !all && (await mtime(dst)) >= (await mtime(src));
// the Basis encoder prints its progress on stdout; keep only our lines
const log = console.log.bind(console);
const kb = n => `${(n / 1024).toFixed(0)} KB`;

async function findSource(prefix) {
  const dir = dirname(prefix), stem = basename(prefix);
  for (const f of await readdir(dir)) if (f.replace(extname(f), '') === stem) return join(dir, f);
  throw new Error(`no source for ${prefix}`);
}

let before = 0, after = 0;
for (const it of manifest.items) {
  if (it.model) {
    const src = join(SRC, it.out), dst = join(OUT, it.out);
    if (await fresh(src, dst)) continue;
    await MeshoptEncoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(src);
    await doc.transform(dedup(), prune({ keepExtras: true }), quantize({ quantizePosition: 14, quantizeNormal: 10 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await mkdir(dirname(dst), { recursive: true }); await io.write(dst, doc);
    const a = (await stat(src)).size, b = (await stat(dst)).size; before += a; after += b;
    log(`${it.out}: ${kb(a)} -> ${kb(b)}`);
    continue;
  }
  if (it.files) {
    for (const suffix of Object.keys(it.files)) {
      const src = join(SRC, it.out + (suffix.startsWith('.') ? '' : '_') + suffix), dst = join(OUT, it.out + (suffix.startsWith('.') ? '' : '_') + suffix);
      if (await fresh(src, dst)) continue;
      await mkdir(dirname(dst), { recursive: true }); await copyFile(src, dst);
      const a = (await stat(src)).size; before += a; after += a; log(`${it.out}_${suffix}: copied (${kb(a)})`);
    }
    continue;
  }
  for (const [key, [, kind]] of Object.entries(it.maps)) {
    const src = await findSource(join(SRC, `${it.out}_${key}`)), dst = join(OUT, `${it.out}_${key}.ktx2`);
    if (await fresh(src, dst)) continue;
    let buf = new Uint8Array(await readFile(src));
    const size = kind === 'normal' && it.normalSize ? it.normalSize : it.size;
    if (size) buf = new Uint8Array(await sharp(buf).resize(size, size).png().toBuffer());
    const ktx = await encodeToKTX2(buf, { ...OPTS[kind], generateMipmap: true, isYFlip: true, imageDecoder: decode, enableDebug: false });
    await mkdir(dirname(dst), { recursive: true }); await writeFile(dst, ktx);
    const a = (await stat(src)).size; before += a; after += ktx.length;
    log(`${it.out}_${key} (${kind}): ${kb(a)} -> ${kb(ktx.length)}`);
  }
}

// credits for everything shipped, from the same list
const lines = ['# Créditos dos assets', '', 'Gerado por `scripts/compress-assets.mjs` a partir de `assets/assets.json`.', '', '| Ficheiros | Origem | Licença |', '| --- | --- | --- |'];
for (const it of manifest.items) lines.push(`| \`public/${it.out}*\` | ${it.polyhaven ? `[${it.name}](https://polyhaven.com/a/${it.polyhaven}) (Poly Haven)` : `\`${it.own}\``} | ${it.license} |`);
await writeFile(join(OUT, 'kit', 'CREDITOS.md'), lines.join('\n') + '\n');
if (before) log(`total: ${kb(before)} -> ${kb(after)}`);
