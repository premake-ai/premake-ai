"""Mesh checks on the exported STLs, pure numpy (+ scipy.ndimage): no OCC calls, so nothing here can crash the CAD
kernel, and every check only ever prints warnings.

    interference(items, ...)   pairs of parts that overlap (voxels from ray columns, depth via a distance transform)
    screw_checks(...)          a hole under each bought screw, a screwdriver path above its head
    thin_walls(tris)           wall thickness from axis rays, corrected by the wall's normal (views.sh)

Ray columns: for a grid of rays along one axis, every triangle crossing (where, which triangle, which way it faces).
Inside / outside comes from the winding count along each column, so a library part made of several closed shells
still works, and a column whose crossings don't balance (an open mesh) is ignored instead of guessed.
"""
import time

import numpy as np

AXES = {0: (1, 2, 0), 1: (2, 0, 1), 2: (0, 1, 2)}  # ray axis -> (u, v, w) cyclic, so u x v = w
JIT = 1.2345e-4  # grid offset (mm): rays never land exactly on CAD edges / vertices at round coordinates


def bbox(tris):
    v = tris.reshape(-1, 3)
    return v.min(0), v.max(0)


def column_hits(tris, axis, u0, v0, h, nu, nv, max_pairs=12_000_000):
    """Crossings of the rays u = u0 + (i + .5) h, v = v0 + (j + .5) h (i < nu, j < nv) running along `axis` with the
    triangles. Returns (col = i * nv + j, w = coordinate along the axis, s = +1 where the surface faces +axis
    (a ray going +axis leaves the solid there), tri index)."""
    ui, vi, wi = AXES[axis]
    U, V, W = tris[:, :, ui], tris[:, :, vi], tris[:, :, wi]
    gu0, gv0 = u0 + JIT, v0 + JIT * 0.7
    i0 = np.maximum(np.ceil((U.min(1) - gu0) / h - 0.5), 0).astype(np.int64)
    i1 = np.minimum(np.floor((U.max(1) - gu0) / h - 0.5), nu - 1).astype(np.int64)
    j0 = np.maximum(np.ceil((V.min(1) - gv0) / h - 0.5), 0).astype(np.int64)
    j1 = np.minimum(np.floor((V.max(1) - gv0) / h - 0.5), nv - 1).astype(np.int64)
    area = (U[:, 1] - U[:, 0]) * (V[:, 2] - V[:, 0]) - (U[:, 2] - U[:, 0]) * (V[:, 1] - V[:, 0])
    ni, nj = i1 - i0 + 1, j1 - j0 + 1
    ok = (ni > 0) & (nj > 0) & (np.abs(area) > 1e-12)
    idx = np.nonzero(ok)[0]
    cnt = ni[idx] * nj[idx]
    total = int(cnt.sum())
    if total == 0:
        e = np.zeros(0, np.int64)
        return e, np.zeros(0), e, e
    if total > max_pairs:
        raise MemoryError(f"{total} ray/triangle pairs")
    t = np.repeat(idx, cnt)
    k = np.arange(total) - np.repeat(np.cumsum(cnt) - cnt, cnt)
    njr = nj[t]
    ii, jj = i0[t] + k // njr, j0[t] + k % njr
    pu, pv = gu0 + (ii + 0.5) * h, gv0 + (jj + 0.5) * h
    Ut, Vt, A = U[t], V[t], area[t]
    w0 = ((Ut[:, 1] - pu) * (Vt[:, 2] - pv) - (Ut[:, 2] - pu) * (Vt[:, 1] - pv)) / A
    w1 = ((Ut[:, 2] - pu) * (Vt[:, 0] - pv) - (Ut[:, 0] - pu) * (Vt[:, 2] - pv)) / A
    w2 = 1.0 - w0 - w1
    inb = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
    t, ii, jj, w0, w1, w2 = t[inb], ii[inb], jj[inb], w0[inb], w1[inb], w2[inb]
    Wt = W[t]
    w = w0 * Wt[:, 0] + w1 * Wt[:, 1] + w2 * Wt[:, 2]
    return ii * nv + jj, w, np.sign(area[t]).astype(np.int64), t


def occupancy(tris, lo, h, shape):
    """Boolean voxel grid (nx, ny, nz) of where the mesh is solid; voxel centres at lo + (idx + .5) h."""
    nx, ny, nz = shape
    col, w, s, _ = column_hits(tris, 2, lo[0], lo[1], h, nx, ny)
    zc = lo[2] + JIT * 0.3 + (np.arange(nz) + 0.5) * h
    k = np.searchsorted(zc, w)  # first voxel centre above the crossing
    D = np.bincount(col * (nz + 1) + k, weights=-s, minlength=nx * ny * (nz + 1)).reshape(nx * ny, nz + 1)
    bad = np.abs(D.sum(1)) > 0.5  # unbalanced column: open mesh or a ray through an edge
    wind = np.cumsum(D[:, :nz], 1)
    occ = (np.abs(wind) > 0.5) & ~bad[:, None]
    return occ.reshape(nx, ny, nz)


# ---------------------------------------------------------------------------------------------- interference

def interference(items, allowed=(), budget_s=4.0, max_vox=1_500_000, min_vol=10.0, min_depth=0.5, bought=()):
    """items: [(name, tris, lo, hi)]. allowed: set of frozenset({a, b}) pairs and plain names (overlap anything).
    bought: names of bought parts and the user's own items; a pair of two of them is not checked (pins in sockets,
    a sensor in the soil: their placement, not something the design can cut a pocket for).
    Returns (hits, stats): hits = [dict(a, b, vol, lo, hi, depth)], stats = dict(pairs, checked, skipped, timed_out).
    An overlap only counts when it is deeper than ~2 x min_depth (press fits and screw threads are thinner) and
    bigger than min_vol mm^3."""
    t0 = time.time()
    pairs = []
    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            na, ta, la, ha = items[a]
            nb, tb, lb, hb = items[b]
            if na in allowed or nb in allowed or frozenset((na, nb)) in allowed or (na in bought and nb in bought):
                continue
            lo, hi = np.maximum(la, lb), np.minimum(ha, hb)
            if np.all(hi - lo > 2 * min_depth):  # bounding boxes overlap by more than a press fit
                pairs.append((a, b, lo, hi))
    hits, checked, timed_out = [], 0, 0
    for a, b, lo, hi in sorted(pairs, key=lambda p: float(np.prod(p[3] - p[2]))):
        if time.time() - t0 > budget_s:
            timed_out += 1
            continue
        ext = hi - lo
        h = max(0.3, float(np.prod(ext) / max_vox) ** (1 / 3))
        shape = tuple(int(n) for n in np.maximum(np.ceil(ext / h), 1))
        try:
            occ = None
            for idx in (a, b):
                tr = items[idx][1]
                mn, mx = tr.min(1), tr.max(1)
                keep = (mx[:, 0] >= lo[0]) & (mn[:, 0] <= hi[0]) & (mx[:, 1] >= lo[1]) & (mn[:, 1] <= hi[1])
                o = occupancy(tr[keep], lo, h, shape)
                occ = o if occ is None else (occ & o)
                if not occ.any():
                    break
        except MemoryError:
            timed_out += 1
            continue
        checked += 1
        n = int(occ.sum())
        if n * h ** 3 < min_vol:
            continue
        from scipy import ndimage  # only when something overlaps (a cold import costs ~0.3 s)
        dist = ndimage.distance_transform_edt(np.pad(occ, 1), sampling=h)[1:-1, 1:-1, 1:-1]
        depth = float(dist.max())
        if depth < max(min_depth, 1.5 * h):
            continue
        where = np.argwhere(occ)
        vlo = lo + where.min(0) * h
        vhi = lo + (where.max(0) + 1) * h
        hits.append(dict(a=items[a][0], b=items[b][0], vol=n * h ** 3, lo=vlo, hi=vhi, depth=2 * depth))
    return hits, dict(pairs=len(pairs), checked=checked, timed_out=timed_out, seconds=time.time() - t0)


# ---------------------------------------------------------------------------------------------- single rays

def ray_hits(tris, origin, d, tmax=np.inf):
    """Möller-Trumbore: sorted (t, facing) of every crossing of the ray origin + t d (t >= 0, unit d) with the mesh.
    facing = +1 where the ray leaves the solid (surface normal along d), -1 where it enters."""
    o, d = np.asarray(origin, float), np.asarray(d, float)
    a, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    s = o - a
    u = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    v = (q @ d) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= tmax)
    n = np.cross(e1[hit], e2[hit]) @ d
    order = np.argsort(t[hit])
    return t[hit][order], np.sign(n[order])


def inside_length(tris, origin, d, length):
    """mm of the segment origin .. origin + length d that lies inside the mesh (winding count along the ray; a
    segment that starts inside is counted from the crossings behind it)."""
    o = np.asarray(origin, float) - np.asarray(d, float) * 1e4
    t, f = ray_hits(tris, o, d)
    if not len(t) or abs(f.sum()) > 0.5:
        return 0.0
    t = t - 1e4
    wind = np.cumsum(-f)  # winding just after each crossing
    total = 0.0
    for k in range(len(t) - 1):
        if wind[k] > 0.5:
            a, b = max(t[k], 0.0), min(t[k + 1], length)
            if b > a:
                total += b - a
    return total


def _perp(d):
    ref = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    x = np.cross(d, ref)
    x /= np.linalg.norm(x)
    return x, np.cross(d, x)


def _near_segment(p, a, b, r):
    """The part's triangles whose bounding box comes within r of the segment a-b's bounding box (None: none)."""
    lo, hi = np.minimum(a, b) - r, np.maximum(a, b) + r
    if np.any(p["_hi"] < lo) or np.any(p["_lo"] > hi):
        return None
    sel = np.all(p["_mx"] >= lo, 1) & np.all(p["_mn"] <= hi, 1)
    return p["tris"][sel] if sel.any() else None


def screw_checks(screws, parts, order=None, reach=60.0):
    """screws: [dict(name, label, at (head underside / csk top), axis (unit, head side), d, length, head_h, head_d)].
    parts: [dict(name, tris, made (bool), blocks (bool))]: every part except screws. order: {part name: assembly step}
    or None. Returns warning strings.

    Screwdriver path: a part counts as in the way when the screw goes into it (a boss under its own ledge, a counterbore
    too narrow), or when ASSEMBLY puts it in no later than the screw. Without that order, a part the screw doesn't touch
    (a lid, a cover) is assumed to go on afterwards."""
    for p in parts:
        if "_mn" not in p:
            p["_mn"], p["_mx"] = p["tris"].min(1), p["tris"].max(1)
            p["_lo"], p["_hi"] = p["_mn"].min(0), p["_mx"].max(0)
    out = []
    for s in screws:
        at, up = np.asarray(s["at"], float), np.asarray(s["axis"], float)
        down = -up
        L, d = float(s["length"]), float(s["d"])
        tip = at + down * L
        x, y = _perp(up)
        where = "({:.1f}, {:.1f}, {:.1f})".format(*(np.round(at, 1) + 0.0))
        # 1. a hole under it: the axis must be clear through every made part; something must surround the shank
        into = set()
        for p in parts:
            tr = _near_segment(p, at, tip, d)
            if tr is None:
                continue
            if p["made"]:
                solid = inside_length(tr, at, down, L)
                if solid > 1.0:
                    out.append(f"{s['label']} at {where} has no hole in '{p['name']}' (solid for {solid:.1f} of its "
                               f"{L:.0f} mm): cut a pilot / clearance hole on its axis")
            ring = [inside_length(tr, at + (np.cos(a) * x + np.sin(a) * y) * (d / 2 + 0.5), down, L)
                    for a in np.linspace(0, 2 * np.pi, 4, endpoint=False)]
            if max(ring) > 1.0:
                into.add(p["name"])
        if not into:
            out.append(f"{s['label']} at {where} doesn't go into any part (nothing around its shank): check its "
                       f"position and that rot points the shank into the part")
        # 2. a screwdriver path: straight out from the head for `reach` mm
        start = at + up * (float(s["head_h"]) + 0.3)
        r = 0.4 * float(s["head_d"])
        offs = [np.zeros(3)] + [(np.cos(a) * x + np.sin(a) * y) * r for a in np.linspace(0, 2 * np.pi, 6, endpoint=False)]
        best = None
        for p in parts:
            if not p["blocks"]:
                continue
            known = order and s["name"] in order and p["name"] in order
            if p["name"] not in into and not (known and order[p["name"]] <= order[s["name"]]):
                continue  # goes on after this screw (or presumably does)
            tr = _near_segment(p, start, start + up * reach, r + 0.5)
            if tr is None:
                continue
            for off in offs:
                t, _ = ray_hits(tr, start + off, up, reach)
                if len(t) and (best is None or t[0] < best[0]):
                    best = (float(t[0]), p["name"])
        if best:
            out.append(f"screwdriver can't reach {s['label']} at {where}: blocked by '{best[1]}' {best[0]:.0f} mm "
                       f"above the head")
    return out


# ---------------------------------------------------------------------------------------------- wall thickness

def thin_walls(tris, min_wall=1.2, min_floor=0.8, max_rays=25_000, min_hits=3):
    """Wall thickness from rays along X, Y and Z. Each entry / exit pair whose two faces are near-parallel and not too
    oblique gives thickness = length x |cos(angle)|, so slanted walls are measured square to the wall. A flat skin
    (both faces within ~37 deg of horizontal: a floor, roof or plate) prints as layers and only needs min_floor. Returns
    (thinnest mm, [(thickness, (x, y, z))] for thin spots, sorted thinnest first, one per 20 mm cell), or (None, [])."""
    lo, hi = bbox(tris)
    ext = hi - lo
    e1, e2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    nrm = np.cross(e1, e2)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-12)[:, None]
    found = []
    for axis in (0, 1, 2):
        ui, vi, wi = AXES[axis]
        h = max(0.4, float(np.sqrt(ext[ui] * ext[vi] / max_rays)))
        nu, nv = int(np.ceil(ext[ui] / h)) + 1, int(np.ceil(ext[vi] / h)) + 1
        try:
            col, w, s, t = column_hits(tris, axis, lo[ui] - h / 2, lo[vi] - h / 2, h, nu, nv)
        except MemoryError:
            continue
        if not len(col):
            continue
        o = np.lexsort((-s, w, col))  # at a shared face (touching solids) the exit sorts before the entry
        col, w, s, t = col[o], w[o], s[o], t[o]
        # alternate entry / exit inside each column (columns with an odd count are skipped)
        start = np.r_[True, col[1:] != col[:-1]]
        grp = np.cumsum(start) - 1
        pos = np.arange(len(col)) - np.nonzero(start)[0][grp]
        cnt = np.bincount(grp)
        even = (cnt[grp] % 2) == 0
        ent = np.nonzero(even & (pos % 2 == 0))[0]
        ext_ = ent + 1
        ok = (s[ent] < 0) & (s[ext_] > 0)
        ent, ext_ = ent[ok], ext_[ok]
        L = w[ext_] - w[ent]
        na, nb = nrm[t[ent]], nrm[t[ext_]]
        ca, cb = np.abs(na[:, wi]), np.abs(nb[:, wi])
        par = (na * nb).sum(1) < -0.8
        th = L * np.minimum(ca, cb)
        flat = np.minimum(np.abs(na[:, 2]), np.abs(nb[:, 2])) > 0.8  # a floor / roof: layers, not perimeters
        good = par & (ca > 0.5) & (cb > 0.5) & (th < np.where(flat, min_floor, min_wall)) & (L > 0.05)
        if not good.any():
            continue
        c = col[ent[good]]
        uu = lo[ui] - h / 2 + JIT + (c // nv + 0.5) * h
        vv = lo[vi] - h / 2 + JIT * 0.7 + (c % nv + 0.5) * h
        ww = (w[ent[good]] + w[ext_[good]]) / 2
        p = np.zeros((len(c), 3))
        p[:, ui], p[:, vi], p[:, wi] = uu, vv, ww
        found += list(zip(th[good].tolist(), p.tolist()))
    if len(found) < min_hits:
        return None, []
    found.sort(key=lambda f: f[0])
    spots, cells = [], set()
    for th, p in found:  # thinnest per 20 mm cell
        c = tuple(int(np.floor(x / 20.0)) for x in p)
        if c not in cells:
            cells.add(c)
            spots.append((th, tuple(p)))
    return found[0][0], spots
