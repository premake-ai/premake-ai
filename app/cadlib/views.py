"""Quick check views for the design agent:  python -m cadlib.views <design_dir>   (the agent runs ./views.sh)

Renders the last build (manifest.json + STLs) from 4 directions into <design_dir>/views/: iso.png, front.png,
side.png, top.png (512 px each) and sheet.png (all four in a 2x2 grid, labelled), so the agent can Read one image and
compare its model with the user's photo. When ./uploads holds photos it also writes compare.png (photos left, model
right, same height; angle from views/photo_view.json, default iso) and it warns about thin walls on printed parts
(cadlib/meshcheck.py). Pure numpy + Pillow (a small z-buffer rasteriser, flat shading, dark lines at
part boundaries, creases and silhouettes): no VTK, no window server, so it runs inside the build sandbox. ~1 s.
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

from cadlib.safepath import inside

SIZE = 512
SS = int(os.environ.get("VIEWS_SS", "1"))  # supersampling factor (2 = smoother, ~4x slower)
BG = np.array([244, 245, 247], float)
EDGE = np.array([38, 40, 46], float)
# direction from the model towards the camera, and the screen-up vector (same views as cadlib/render_thumb.py)
VIEWS = {
    "iso": ((0.95, -1.35, 0.85), (0, 0, 1)),
    "front": ((0, -1, 0), (0, 0, 1)),
    "side": ((1, 0, 0), (0, 0, 1)),
    "top": ((0, 0, 1), (0, 1, 0)),
}
LABELS = {"iso": "iso (front-right, from above)", "front": "front (looking at -Y face)", "side": "right side (+X)",
          "top": "top (looking down, front at bottom)"}


def read_stl(path):
    """(N, 3, 3) float32 triangles from a binary or ASCII STL."""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) >= 84:
        n = int(np.frombuffer(data, "<u4", 1, 80)[0])
        if 84 + 50 * n == len(data):
            rec = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
            return np.frombuffer(data, rec, n, 84)["v"].astype(np.float32)
    txt = data.decode("latin-1")
    vals = [ln.split()[1:4] for ln in txt.splitlines() if ln.strip().startswith("vertex")]
    v = np.array(vals, np.float32)
    return v[: len(v) // 3 * 3].reshape(-1, 3, 3)


def hex_rgb(h):
    try:
        h = str(h).lstrip("#")
        return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)
    except Exception:
        return np.array([138, 143, 152], float)


def load_items(design_dir):
    """[(triangles, rgb)] for every part in manifest.json (library parts: their coloured subparts)."""
    with open(os.path.join(design_dir, "manifest.json")) as f:
        man = json.load(f)
    items = []
    for p in man.get("parts", []):
        if not isinstance(p, dict):
            continue
        subs = [(inside(design_dir, s.get("file")), s) for s in (p.get("subparts") or []) if isinstance(s, dict)]
        subs = [(fp, s) for fp, s in subs if fp]
        files = [(fp, s.get("color") or p.get("color")) for fp, s in subs] if subs else [(inside(design_dir, p.get("file")), p.get("color"))]
        for fp, col in files:
            if fp:
                try:
                    t = read_stl(fp)
                except Exception:
                    continue
                if len(t):
                    items.append((t, hex_rgb(col or "#8a8f98")))
    return items


def view_dir(azimuth=35.0, elevation=27.0):
    """Camera direction for a photo angle: azimuth 0 = straight at the front (-Y face), positive = camera moved round to
    the right (+X); elevation = degrees above the horizon. The default (35, 27) is the iso view."""
    az, el = np.radians(float(azimuth)), np.radians(float(elevation))
    return (np.sin(az) * np.cos(el), -np.cos(az) * np.cos(el), np.sin(el)), ((0, 1, 0) if abs(float(elevation)) > 89 else (0, 0, 1))


def basis(view):
    d, up = VIEWS[view] if isinstance(view, str) else view
    d = np.array(d, float); d /= np.linalg.norm(d)
    r = np.cross(np.array(up, float), d); r /= np.linalg.norm(r)
    u = np.cross(d, r)
    return r, u, d


def rasterise(tris, part_id, n, R):
    """Z-buffer: per pixel depth, triangle index (-1 = background). tris (N,3,3) in screen coords (x, y px; z depth,
    larger = nearer)."""
    depth = np.full(R * R, -np.inf, np.float32)
    tri = np.full(R * R, -1, np.int64)
    x, y, z = tris[..., 0], tris[..., 1], tris[..., 2]
    x0 = np.clip(np.floor(x.min(1)), 0, R - 1).astype(np.int64)
    x1 = np.clip(np.ceil(x.max(1)), 0, R - 1).astype(np.int64)
    y0 = np.clip(np.floor(y.min(1)), 0, R - 1).astype(np.int64)
    y1 = np.clip(np.ceil(y.max(1)), 0, R - 1).astype(np.int64)
    ext = np.maximum(x1 - x0, y1 - y0) + 1
    area = (x[:, 1] - x[:, 0]) * (y[:, 2] - y[:, 0]) - (x[:, 2] - x[:, 0]) * (y[:, 1] - y[:, 0])
    ok = np.abs(area) > 1e-9
    s = 1
    while True:
        sel = np.nonzero(ok & (ext <= s) & (ext > s // 2 if s > 1 else True))[0]
        if len(sel):
            step = max(1, 3_000_000 // (s * s))
            g = np.arange(s)
            for c in range(0, len(sel), step):
                ids = sel[c:c + step]
                px = (x0[ids, None, None] + g[None, None, :]).astype(np.float32)  # (k, 1, s)
                py = (y0[ids, None, None] + g[None, :, None]).astype(np.float32)  # (k, s, 1)
                cx, cy = px + 0.5, py + 0.5
                X, Y, Z, A = x[ids], y[ids], z[ids], area[ids]
                w0 = ((X[:, 1, None, None] - cx) * (Y[:, 2, None, None] - cy) - (X[:, 2, None, None] - cx) * (Y[:, 1, None, None] - cy)) / A[:, None, None]
                w1 = ((X[:, 2, None, None] - cx) * (Y[:, 0, None, None] - cy) - (X[:, 0, None, None] - cx) * (Y[:, 2, None, None] - cy)) / A[:, None, None]
                w2 = 1 - w0 - w1
                inb = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
                inb &= (cx < x1[ids, None, None] + 1) & (cy < y1[ids, None, None] + 1)
                inb &= (cx < R) & (cy < R)
                zz = w0 * Z[:, 0, None, None] + w1 * Z[:, 1, None, None] + w2 * Z[:, 2, None, None]
                kk, yy, xx = np.nonzero(inb)
                if not len(kk):
                    continue
                pix = (py[kk, yy, 0].astype(np.int64) * R + px[kk, 0, xx].astype(np.int64))
                zv = zz[kk, yy, xx]
                order = np.lexsort((-zv, pix))  # per pixel, nearest first
                pix, zv, tid = pix[order], zv[order], ids[kk[order]]
                first = np.ones(len(pix), bool); first[1:] = pix[1:] != pix[:-1]
                pix, zv, tid = pix[first], zv[first], tid[first]
                better = zv > depth[pix]
                depth[pix[better]] = zv[better]
                tri[pix[better]] = tid[better]
        if s >= R:
            break
        s *= 2
    return depth.reshape(R, R), tri.reshape(R, R)


def render_view(items, view, size=SIZE, span=None):
    R = size * SS
    r, u, d = basis(view)
    tris = np.concatenate([t for t, _ in items]).astype(np.float64)
    cols = np.concatenate([np.repeat((60 + 0.78 * c)[None], len(t), 0) for t, c in items])  # lifted: lines show on dark parts
    pid = np.concatenate([np.full(len(t), i) for i, (t, _) in enumerate(items)])
    sx, sy, sz = tris @ r, tris @ u, tris @ d
    lo = np.array([sx.min(), sy.min()]); hi = np.array([sx.max(), sy.max()])
    span = span or max(hi[0] - lo[0], hi[1] - lo[1], 1e-6)  # one scale for every view: sizes compare across views
    k = R * 0.86 / span
    cx, cy = (lo + hi) / 2
    scr = np.stack([(sx - cx) * k + R / 2, R / 2 - (sy - cy) * k, sz], -1)
    nrm = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    nl = np.linalg.norm(nrm, axis=1); nrm = nrm / np.maximum(nl, 1e-12)[:, None]
    depth, tri = rasterise(scr, pid, nrm, R)
    hit = tri >= 0
    t = np.where(hit, tri, 0)
    n = nrm[t]
    n = np.where((n @ d)[..., None] < 0, -n, n)  # two-sided
    light = np.array([0.35, -0.55, 0.75]) + 0.6 * d; light /= np.linalg.norm(light)
    shade = 0.42 + 0.58 * np.clip(n @ light, 0, 1)
    img = np.where(hit[..., None], cols[t] * shade[..., None], BG)
    # lines: silhouette (hit vs background), part boundaries, creases (normals > ~40 deg apart), depth steps
    part = np.where(hit, pid[t], -1)
    dz = span * 0.012  # model units
    edge = np.zeros_like(hit)
    depth = np.where(hit, depth, -1e9)
    for a, b in (((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
                 ((slice(1, None), slice(None)), (slice(None, -1), slice(None)))):
        e = (part[a] != part[b])
        both = hit[a] & hit[b]
        e |= both & ((n[a] * n[b]).sum(-1) < 0.77)
        e |= both & (np.abs(depth[a] - depth[b]) > dz)
        edge[a] |= e
    img = np.where(edge[..., None], EDGE, img)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    return im.resize((size, size), Image.LANCZOS) if SS > 1 else im


def render_design(design_dir, out_dir=None):
    design_dir = os.path.abspath(design_dir)
    out_dir = out_dir or os.path.join(design_dir, "views")
    os.makedirs(out_dir, exist_ok=True)
    items = load_items(design_dir)
    if not items:
        raise SystemExit("views: no parts to render (run ./build.sh first)")
    allv = np.concatenate([t.reshape(-1, 3) for t, _ in items])
    dims = allv.max(0) - allv.min(0)
    sheet = Image.new("RGB", (SIZE * 2, SIZE * 2), tuple(int(c) for c in BG))
    dr = ImageDraw.Draw(sheet)
    span = float(np.linalg.norm(dims)) * 0.9  # fits any view direction
    for i, v in enumerate(VIEWS):
        im = render_view(items, v, span=span)
        im.save(os.path.join(out_dir, f"{v}.png"))
        ox, oy = (i % 2) * SIZE, (i // 2) * SIZE
        sheet.paste(im, (ox, oy))
        dr.text((ox + 8, oy + 6), LABELS[v], fill=(90, 92, 100))
    dr.line([(SIZE, 0), (SIZE, 2 * SIZE)], fill=(205, 207, 212)); dr.line([(0, SIZE), (2 * SIZE, SIZE)], fill=(205, 207, 212))
    dr.text((8, 2 * SIZE - 18), f"overall {dims[0]:.0f} x {dims[1]:.0f} x {dims[2]:.0f} mm (X x Y x Z)", fill=(90, 92, 100))
    sheet.save(os.path.join(out_dir, "sheet.png"))
    return out_dir, dims


PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
COMPARE_H = 512


def _crop_to_content(im, bg=BG, pad=0.06):
    a = np.asarray(im.convert("RGB")).astype(int)
    ys, xs = np.nonzero(np.abs(a - np.asarray(bg, int)[None, None]).sum(-1) > 24)
    if not len(xs):
        return im
    w, h = xs.max() - xs.min(), ys.max() - ys.min()
    p = int(max(w, h) * pad) + 4
    return im.crop((max(xs.min() - p, 0), max(ys.min() - p, 0), min(xs.max() + p, im.width), min(ys.max() + p, im.height)))


def photo_compare(design_dir, items, out_dir, max_photos=3):
    """views/compare.png: the user's photo(s) from ./uploads on the left, the model on the right, all the same height,
    labelled "Photo" / "Model". The model is drawn from views/photo_view.json {"azimuth": deg, "elevation": deg}
    (see view_dir) when the agent wrote one, else from the iso angle. Returns (path, angle text) or None."""
    from PIL import ImageOps
    up = os.path.join(design_dir, "uploads")
    try:
        names = [n for n in os.listdir(up) if n.lower().endswith(PHOTO_EXT) and not n.startswith(".")]
    except OSError:
        return None
    photos = []
    for n in sorted(names, key=lambda n: os.path.getmtime(os.path.join(up, n)), reverse=True)[:max_photos]:
        fp = inside(design_dir, os.path.join("uploads", n))
        if not fp:
            continue
        try:
            with Image.open(fp) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((4096, COMPARE_H * 2))
                photos.append(im.resize((max(1, round(im.width * COMPARE_H / im.height)), COMPARE_H), Image.LANCZOS))
        except Exception:
            continue
    if not photos:
        return None
    az, el, src = 35.0, 27.0, "iso, the default"
    try:
        with open(os.path.join(out_dir, "photo_view.json")) as f:
            pv = json.load(f)
        az, el = float(pv.get("azimuth", az)), max(-90.0, min(90.0, float(pv.get("elevation", el))))
        src = "from views/photo_view.json"
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    model = _crop_to_content(render_view(items, view_dir(az, el), size=COMPARE_H))
    model = model.resize((max(1, round(model.width * COMPARE_H / model.height)), COMPARE_H), Image.LANCZOS)
    gap = 8
    W = sum(p.width for p in photos) + gap * len(photos) + model.width
    out = Image.new("RGB", (W, COMPARE_H), (255, 255, 255))
    dr = ImageDraw.Draw(out)
    x = 0
    for p in photos:
        out.paste(p, (x, 0))
        x += p.width + gap
    out.paste(model, (x, 0))
    for lx, text in ((0, "Photo"), (x, "Model")):
        tw = dr.textlength(text)
        dr.rectangle([lx + 6, 6, lx + 14 + tw, 22], fill=(255, 255, 255))
        dr.text((lx + 10, 8), text, fill=(40, 42, 48))
    path = os.path.join(out_dir, "compare.png")
    out.save(path)
    return path, f"azimuth {az:g}, elevation {el:g} ({src})"


def wall_check(design_dir, min_wall=1.2):
    """Thin walls on each printed part (cadlib/meshcheck.thin_walls): warning lines."""
    from cadlib import meshcheck
    with open(os.path.join(design_dir, "manifest.json")) as f:
        man = json.load(f)
    out, n = [], 0
    for p in man.get("parts", []):
        if not isinstance(p, dict) or p.get("process") != "print":
            continue
        fp = inside(design_dir, p.get("file"))
        if not fp:
            continue
        try:
            thin, spots = meshcheck.thin_walls(read_stl(fp).astype(np.float64), min_wall)
        except Exception:
            continue
        n += 1
        if thin is not None:
            where = "; ".join(f"{t:.1f} mm at ({round(c[0])}, {round(c[1])}, {round(c[2])})" for t, c in spots[:3])
            more = f" (+{len(spots) - 3} more places)" if len(spots) > 3 else ""
            out.append(f"WARNING: '{p.get('name')}' has walls thinner than {min_wall:g} mm (floors 0.8 mm), too thin "
                       f"to print well: {where}{more}. Thicken them.")
    return out, n


def main():
    if len(sys.argv) < 2:
        print("usage: python -m cadlib.views <design_dir>")
        sys.exit(2)
    t0 = time.time()
    try:
        with open(os.path.join(sys.argv[1], "build_log.txt")) as f:
            if "BUILD FAILED" in f.read():
                print("views: the latest build FAILED, so these views show the last good build. Fix and ./build.sh first.")
    except OSError:
        pass
    design_dir = os.path.abspath(sys.argv[1])
    out, dims = render_design(design_dir)
    print(f"views: sheet.png (iso, front, side, top) + one png per view in ./views/ ({time.time() - t0:.1f}s). "
          f"Overall {dims[0]:.0f} x {dims[1]:.0f} x {dims[2]:.0f} mm.")
    try:
        cmp = photo_compare(design_dir, load_items(design_dir), out)
        if cmp:
            print(f"photo: ./views/compare.png = the photo (left) next to the model (right), model seen at {cmp[1]}. "
                  f"Read it and compare the two.")
    except Exception as e:
        print(f"photo: compare.png skipped ({type(e).__name__}: {e})")
    try:
        warns, n = wall_check(design_dir)
        for w in warns:
            print(w)
        print(f"wall check: {n} printed parts, {len(warns)} with thin walls")
    except Exception as e:
        print(f"wall check skipped ({type(e).__name__}: {e})")
    print(f"views done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
