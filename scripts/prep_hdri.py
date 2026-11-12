"""Prepare a Poly Haven HDRI for the web (shared with the apartment walkthrough).

  python scripts/prep_hdri.py <in.hdr> <out_dir> [--name ceu] [--env 1024] [--bg 2048]

Writes <name>_env.hdr (small Radiance RGBE, RLE, for the image-based light, sun cut out and a grass ground below the
horizon), <name>_fundo.jpg (background: linear radiance / bgScale, sRGB-encoded, so the page tone maps it like the scene)
and <name>.json (bgScale, horizon haze colour, sun direction and irradiance) and prints the sun direction found in the HDRI (brightest region), so the
real-time sun can be lined up with the sky. Needs only numpy + Pillow.
"""
import argparse, json, math, os, re
import numpy as np
from PIL import Image


def read_hdr(path):
    with open(path, 'rb') as f:
        data = f.read()
    head_end = data.index(b'\n\n') + 2
    m = re.match(rb'([-+])Y (\d+) ([-+])X (\d+)\n', data[head_end:head_end + 64])
    h, w = int(m.group(2)), int(m.group(4))
    p = head_end + m.end()
    out = np.zeros((h, w, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(h):
        if buf[p] == 2 and buf[p + 1] == 2 and (int(buf[p + 2]) << 8 | int(buf[p + 3])) == w:   # new RLE
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = int(buf[p]); p += 1
                    if n > 128:
                        n -= 128; out[y, x:x + n, c] = buf[p]; p += 1
                    else:
                        out[y, x:x + n, c] = buf[p:p + n]; p += n
                    x += n
        else:                                                                           # flat
            out[y] = buf[p:p + w * 4].reshape(w, 4); p += w * 4
    e = out[..., 3].astype(np.float32)
    scale = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(np.int32)), 0.0)
    return out[..., :3].astype(np.float32) * scale[..., None]


def write_hdr(path, img):
    h, w, _ = img.shape
    mx = img.max(axis=2)
    mant, ex = np.frexp(mx)
    rgbe = np.zeros((h, w, 4), np.uint8)
    ok = mx > 1e-32
    sc = np.where(ok, mant * 256.0 / np.maximum(mx, 1e-32), 0)
    rgbe[..., :3] = np.clip(img * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(ok, ex + 128, 0).astype(np.uint8)
    out = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
    for y in range(h):
        out += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            row = rgbe[y, :, c]; x = 0
            while x < w:                       # runs of >= 3 equal bytes become run packets
                r = x
                while r < w and r - x < 127 and row[r] == row[x]:
                    r += 1
                if r - x >= 3:
                    out += bytes([128 + r - x, int(row[x])]); x = r; continue
                s = x
                while x < w and x - s < 128 and not (x + 2 < w and row[x] == row[x + 1] == row[x + 2]):
                    x += 1
                out += bytes([x - s]) + row[s:x].tobytes()
    with open(path, 'wb') as f:
        f.write(out)


def shrink(img, w):
    k = img.shape[1] // w
    h = img.shape[0] // k
    return img[:h * k, :w * k].reshape(h, k, w, k, 3).mean(axis=(1, 3))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('src'); a.add_argument('out')
    a.add_argument('--name', default='ceu'); a.add_argument('--env', type=int, default=1024)
    a.add_argument('--bg', type=int, default=2048); a.add_argument('--sun-azimuth', type=float, default=None, help='degrees, atan2(z, x) in three.js world'); a.add_argument('--ground', type=lambda t: [float(x) for x in t.split(',')], default=[0.11, 0.13, 0.07])
    o = a.parse_args()
    os.makedirs(o.out, exist_ok=True)
    img = read_hdr(o.src)
    h, w, _ = img.shape
    # sun: brightest 0.01% of pixels, luminance-weighted mean direction. three.js equirect convention:
    # u = atan2(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5 (row 0 = straight up)
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    thr = np.quantile(lum, 0.9999)
    ys, xs = np.nonzero(lum >= thr)
    wt = lum[ys, xs]
    u = (xs + 0.5) / w; v = (ys + 0.5) / h
    phi = (u - 0.5) * 2 * math.pi; theta = (0.5 - v) * math.pi            # azimuth, elevation
    d = np.stack([np.cos(theta) * np.cos(phi), np.sin(theta), np.cos(theta) * np.sin(phi)], 1)
    sun = (d * wt[:, None]).sum(0); sun /= np.linalg.norm(sun)
    if o.sun_azimuth is not None:   # turn the whole sky so the sun stands where the page's default camera shows lit facades
        rot = math.radians(o.sun_azimuth) - math.atan2(sun[2], sun[0])
        img = np.roll(img, int(round(rot / (2 * math.pi) * w)), axis=1); lum = np.roll(lum, int(round(rot / (2 * math.pi) * w)), axis=1)
        c, s_ = math.cos(rot), math.sin(rot)
        sun = np.array([sun[0] * c - sun[2] * s_, sun[1], sun[0] * s_ + sun[2] * c])
    # Poly Haven "puresky" HDRIs mirror the sky below the horizon; light from below must come from the ground instead:
    # a Lambert ground of the given albedo lit by the upper hemisphere (E / pi), blended over the first 2 degrees.
    # the sun itself becomes the page's DirectionalLight (with shadows): cut it out of the env so it is not lit twice
    cap = float(np.quantile(lum[:h // 2], 0.998)) * 1.5
    over = np.maximum(lum / cap, 1.0)
    th_px = (0.5 - (np.arange(h) + 0.5) / h) * math.pi
    dom_px = (math.pi / h) * (2 * math.pi / w) * np.cos(th_px)
    orig = img
    cut = img - img / over[..., None]
    sun_E = float(((cut @ np.array([0.2126, 0.7152, 0.0722], np.float32)) * dom_px[:, None]).sum())   # perpendicular
    img = img / over[..., None]
    up = img[:h // 2]
    th = (0.5 - (np.arange(h // 2) + 0.5) / h) * math.pi
    dom = (math.pi / (h // 2)) * (2 * math.pi / w) * np.cos(th)                     # solid angle per pixel row
    E = (up * (np.sin(th) * dom)[:, None, None]).sum((0, 1))
    ground = np.array(o.ground, np.float32) * E / math.pi
    th_all = (0.5 - (np.arange(h) + 0.5) / h) * math.pi
    k = np.clip(-th_all / math.radians(2), 0, 1)[:, None, None]
    lit = img * (1 - k) + ground * k
    env = shrink(lit, o.env)
    # the sun's energy stays in the env map; the page removes nothing, it only dims the env a little (envMapIntensity)
    write_hdr(os.path.join(o.out, f'{o.name}_env.hdr'), env.astype(np.float32))
    # background: linear radiance scaled into 0..1 and stored as sRGB JPG; the page multiplies it back (bgScale) and tone
    # maps it with the rest of the scene. Below the horizon: the haze colour just above it (the fog colour on the page).
    bg = shrink(orig, o.bg)
    bh = bg.shape[0]
    horizon = bg[int(bh * 0.46):bh // 2].reshape(-1, 3).mean(0)
    rows = (0.5 - (np.arange(bh) + 0.5) / bh) * 180
    k = np.clip(-rows / 1.5, 0, 1)[:, None, None]
    bg = bg * (1 - k) + horizon * k
    blum = bg[: bh // 2] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    bg_scale = float(np.quantile(blum, 0.999)) * 1.15
    x = np.clip(bg / bg_scale, 0, 1)
    srgb = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).save(os.path.join(o.out, f'{o.name}_fundo.jpg'), quality=88, optimize=True, progressive=True)
    info = {'bgScale': round(bg_scale, 4), 'horizon': [round(float(c), 4) for c in horizon], 'sunIrradiance': round(sun_E, 3), 'groundRadiance': [round(float(c), 4) for c in ground], 'sun': [round(float(c), 4) for c in sun], 'sunElevationDeg': round(math.degrees(math.asin(sun[1])), 1),
            'envSize': list(env.shape[:2][::-1]), 'source': os.path.basename(o.src)}
    with open(os.path.join(o.out, f'{o.name}.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info))


if __name__ == '__main__':
    main()
