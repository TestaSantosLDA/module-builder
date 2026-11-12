"""Download the Poly Haven (CC0) assets listed in assets/assets.json and turn them into the sources in assets/
(shared with the apartment walkthrough: same manifest format, point --manifest at another file).

  python scripts/fetch_polyhaven.py                 # downloads what is missing into .polyhaven/ (git-ignored)
  python scripts/fetch_polyhaven.py --only relva    # entries whose 'out' contains this text
  then: node scripts/compress-assets.mjs

Run it on the PC: the cloud sessions cannot reach Poly Haven. Needs Pillow (pip install pillow).
Map names in the manifest are Poly Haven's ('Diffuse', 'nor_gl', 'arm', 'Rough', 'AO'); 'ao+rough' packs AO (R) and
roughness (G) into one image, like Poly Haven's own ARM maps.
"""
import argparse, json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) treehouse-studio/1.0'}


def api(asset):
    return json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers=UA), timeout=60))


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        data = r.read()
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)
    print('got', os.path.relpath(path, ROOT), f'{len(data) / 1e6:.1f} MB', flush=True)
    return path


def map_file(files, key, res, cache, asset):
    fmt = 'jpg' if 'jpg' in files[key][res] else 'png'
    return get(files[key][res][fmt]['url'], os.path.join(cache, asset, f'{asset}_{key}_{res}.{fmt}'))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--manifest', default=os.path.join(ROOT, 'assets', 'assets.json'))
    a.add_argument('--cache', default=os.path.join(ROOT, '.polyhaven'))
    a.add_argument('--only', default='')
    o = a.parse_args()
    from PIL import Image
    src_root = os.path.dirname(o.manifest)
    for it in json.load(open(o.manifest, encoding='utf-8'))['items']:
        asset = it.get('polyhaven')
        if not asset or it.get('impostor') or o.only not in it['out']:  # impostors are rendered in Blender, not downloaded
            continue
        files, res = api(asset), it.get('res', '1k')
        if it.get('hdri'):
            hdr = get(files['hdri'][res]['hdr']['url'], os.path.join(o.cache, asset, f'{asset}_{res}.hdr'))
            cmd = it['prep'].replace('python ', sys.executable + ' ', 1).replace('<download>_4k.hdr', hdr).replace('<download>.hdr', hdr).split()
            subprocess.run(cmd, check=True, cwd=ROOT)
            continue
        for out_key, (ph_key, _kind) in it['maps'].items():
            dst = os.path.join(src_root, it['out'] + f'_{out_key}.jpg')
            if os.path.exists(dst):
                continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if ph_key == 'ao+rough':
                ao = Image.open(map_file(files, 'AO', res, o.cache, asset)).convert('L')
                ro = Image.open(map_file(files, 'Rough', res, o.cache, asset)).convert('L')
                img = Image.merge('RGB', (ao, ro.resize(ao.size), Image.new('L', ao.size, 0)))
            else:
                img = Image.open(map_file(files, ph_key, res, o.cache, asset)).convert('RGB')
            if it.get('size'):
                img = img.resize((it['size'], it['size']), Image.LANCZOS)
            img.save(dst, quality=94)
            print('wrote', os.path.relpath(dst, ROOT))
    print('done; now run: node scripts/compress-assets.mjs')


if __name__ == '__main__':
    main()
