"""Write the product-photo studio environment:  python -m cadlib.make_studio_hdr [out.hdr] [width]

A procedural photo studio (our own work, CC0): soft grey cyclorama walls, a warm floor, a big overhead-left key softbox,
a wide fill panel on the right, a tall rim strip behind and two thin strip lights that draw long highlights on metal and
gloss. Equirectangular, Radiance RGBE with scanline RLE, Y up, using three.js' equirect convention (the centre column
looks down +X, a quarter to the right looks down +Z, row 0 is straight up), so the key sits up and to the front-left of
the default iso camera (which looks from -X/+Z). The same file lights the web viewer (web/photoreal.js) and the VTK
server renders (cadlib/photo.py), so thumbnails and the live view match.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "env", "studio-1k.hdr")


def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _basis(c):
    c = _n(c)
    up = np.array([0.0, 1.0, 0.0]) if abs(c[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
    r = _n(np.cross(up, c))
    u = np.cross(c, r)
    return c, r, u


def softbox(d, centre, half_w, half_h, power, color=(1, 1, 1), soft=0.18, roll=0.0):
    """Rectangular emitter seen from the origin: half sizes in degrees, soft edge as a fraction of the size."""
    c, r, u = _basis(centre)
    if roll:
        a = np.radians(roll)
        r, u = r * np.cos(a) + u * np.sin(a), -r * np.sin(a) + u * np.cos(a)
    z = d @ c
    x = (d @ r) / np.maximum(z, 1e-4)
    y = (d @ u) / np.maximum(z, 1e-4)
    tw, th = np.tan(np.radians(half_w)), np.tan(np.radians(half_h))

    def edge(t, half):
        a = np.abs(t) / half
        return np.clip((1 + soft - a) / (2 * soft), 0, 1)

    k = edge(x, tw) * edge(y, th) * (z > 0)
    # a real softbox is brighter in the middle and has a faint hot spot
    k = k * (0.82 + 0.18 * np.exp(-((x / tw) ** 2 + (y / th) ** 2) * 1.5))
    return k[..., None] * (power * np.asarray(color))[None, None, :]


def studio(width=1024):
    h = width // 2
    v = (np.arange(h) + 0.5) / h            # 0 at the top row
    u = (np.arange(width) + 0.5) / width
    lat = (0.5 - v) * np.pi                 # +pi/2 up
    phi = (u - 0.5) * 2 * np.pi
    LAT, PHI = np.meshgrid(lat, phi, indexing="ij")
    d = np.stack([np.cos(PHI) * np.cos(LAT), np.sin(LAT), np.sin(PHI) * np.cos(LAT)], axis=-1)
    y = d[..., 1]

    # cyclorama: light grey walls a touch brighter at eye level, darker ceiling, warm grey floor fading to the nadir
    wall = 0.17 + 0.06 * np.exp(-(y / 0.22) ** 2)
    ceil = 0.11 + 0.03 * (1 - y)
    floor = 0.2 * (0.5 + 0.5 * np.clip(1 + y * 1.6, 0, 1))
    up = np.clip((y - 0.35) / 0.4, 0, 1)
    up = up * up * (3 - 2 * up)
    sky = wall * (1 - up) + ceil * up
    hz = np.clip((y + 0.04) / 0.08, 0, 1)                  # soft horizon: the cyc curves into the floor
    base = sky * hz + floor * (1 - hz)
    tone = hz[..., None] * np.array([0.98, 0.99, 1.0]) + (1 - hz[..., None]) * np.array([1.0, 0.97, 0.93])
    img = base[..., None] * tone
    # soft, large-scale variation so reflections never look like a flat colour (deterministic)
    rng = np.random.default_rng(7)
    for _ in range(6):
        c = _n(rng.normal(size=3) * np.array([1, 0.35, 1]))
        k = np.exp((d @ c - 1) / 0.08)
        img *= 1 + 0.06 * k[..., None] * rng.uniform(-1, 1)

    img += softbox(d, (-0.55, 0.78, 0.42), 26, 19, 11.0, (1.0, 0.975, 0.94))     # key: overhead, front-left
    img += softbox(d, (0.9, 0.22, 0.38), 30, 22, 2.6, (0.97, 0.99, 1.0))         # fill: wide panel, right
    img += softbox(d, (0.25, 0.32, -0.95), 5, 30, 9.0, (1.0, 1.0, 1.0), 0.25)    # rim strip, behind
    img += softbox(d, (-0.95, 0.30, -0.3), 3, 24, 6.0, (1.0, 0.99, 0.97), 0.3)   # strip left-back: long metal highlights
    img += softbox(d, (0.35, 0.95, 0.05), 40, 40, 0.8, (1.0, 1.0, 1.0), 0.5)     # overhead bounce
    img += softbox(d, (0.2, 0.05, 0.98), 9, 5, 2.2, (1.0, 0.98, 0.95), 0.35)     # small front card: catchlight
    return img.astype(np.float32)


def _rgbe(img):
    m = img.max(axis=-1)
    e = np.zeros(m.shape, dtype=np.int32)
    mant, e = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0)
    out = np.zeros(img.shape[:2] + (4,), dtype=np.uint8)
    out[..., :3] = np.clip(img * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    return out


def _rle(row):
    out = bytearray()
    i, n = 0, len(row)
    while i < n:
        j = i
        while j < n and j - i < 127 and row[j] == row[i]:
            j += 1
        if j - i >= 3:
            out += bytes([128 + (j - i), row[i]])
            i = j
            continue
        j = i
        while j < n and j - i < 128 and not (j + 2 < n and row[j] == row[j + 1] == row[j + 2]):
            j += 1
        out += bytes([j - i]) + bytes(row[i:j])
        i = j
    return out


def write_hdr(path, img):
    h, w = img.shape[:2]
    px = _rgbe(img)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path + ".tmp", "wb") as f:
        f.write(b"#?RADIANCE\n# Premake photo studio (procedural, CC0)\nFORMAT=32-bit_rle_rgbe\n\n")
        f.write(f"-Y {h} +X {w}\n".encode())
        for r in range(h):
            f.write(bytes([2, 2, w >> 8, w & 255]))
            for c in range(4):
                f.write(_rle(px[r, :, c].tobytes()))
    os.replace(path + ".tmp", path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    write_hdr(out, studio(width))
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main()
