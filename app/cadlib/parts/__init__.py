"""Library of detailed standard parts:  from cadlib.parts import part

    part("nema17_48", at=(0, 0, 40))                         # one motor
    part("m3x12_shcs", at=[(x, y, 5) for x, y in holes])     # 4 screws, one BOM line with qty 4
    part("esp32_devkitc", at=(0, 30, 3), rot=(0, 0, 90))     # rot = degrees about X, then Y, then Z (part origin)
    part("extrusion_2020", length=400, at=(0, 0, 10))         # shop-made: priced by the build, no BOM line

part() returns a parts() dict (name, shape, group, process, colour, sub-part meshes with finishes, and the bought-part
BOM line, which the build adds to bom.json["parts"] automatically, marked "auto": "lib").

Every part is built once with CadQuery and cached as per-finish STL meshes + meta.json in cadlib/parts/cache/<id>/
(parametric parts are cached per parameter set). A missing entry is built on first use; inside the build sandbox
(cadlib is read-only) it lands in $HOME/.cache/buildery-parts instead. `python -m cadlib.parts.build_cache` prebuilds.
"""
import json
import os
import re
import shutil
import tempfile
import time

from .catalog import ALIASES, CATALOG, bom_line, resolve, value, search_url, prebuild_list  # noqa: F401

LIB_VERSION = 5  # 5: Arduino Nano 18.0 wide (official drawing)
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
KEYS = sorted(CATALOG)
FINISHES = ("pcb", "metal", "gold", "plastic", "rubber", "glass")
DENSITY = {"pcb": 1.85, "gold": 8.5, "plastic": 1.2, "rubber": 1.2, "glass": 2.5}
_mem = {}


def entry_id(key, params):
    bits = []
    for k, v in sorted(params.items()):
        v = f"{v:g}" if isinstance(v, float) else str(v)
        bits.append(f"{k}{v}")
    s = key + ("__" + "_".join(bits) if bits else "")
    return re.sub(r"[^a-z0-9_-]+", "-", s.lower().replace(".", "p"))


def _roots():
    out = [CACHE]
    if os.environ.get("FORMA_PARTS_CACHE"):
        out.append(os.environ["FORMA_PARTS_CACHE"])
    out.append(os.path.join(os.path.expanduser("~"), ".cache", "buildery-parts"))
    out.append(os.path.join(tempfile.gettempdir(), "buildery-parts"))
    return out


def _valid(d):
    try:
        with open(os.path.join(d, "meta.json")) as f:
            meta = json.load(f)
        if meta.get("v") != LIB_VERSION:
            return None
        if all(os.path.isfile(os.path.join(d, g["file"])) for g in meta["groups"]):
            return meta
    except (OSError, ValueError, KeyError):
        pass
    return None


def _metal_density(color):
    c = color.lower()
    if c in ("#c8a04a",):
        return 8.5
    if c in ("#c7ccd2", "#9aa3ad"):
        return 2.7
    return 7.85


def build_entry(key, params, root=None, quiet=True):
    """Build one entry into <root>/<id>/ (atomic). Returns its meta. Needs cadquery."""
    import cadquery as cq
    t0 = time.time()
    spec = CATALOG[key]
    eid = entry_id(key, params)
    model = spec["build"](**params)
    comps = model.compounds()
    if not comps:
        raise RuntimeError(f"library part {key} built no geometry")
    allc = cq.Compound.makeCompound([c for _, _, c in comps])
    bb = allc.BoundingBox()
    size = max(bb.xlen, bb.ylen, bb.zlen)
    tol = min(0.08, max(0.01, size / 600.0))
    roots = [root] if root else _roots()
    last = None
    for r in roots:
        try:
            os.makedirs(r, exist_ok=True)
            tmp = tempfile.mkdtemp(prefix=f".{eid}.", dir=r)
        except OSError as e:
            last = e
            continue
        try:
            groups, mass = [], 0.0
            for i, (finish, color, comp) in enumerate(comps):
                fn = f"g{i}-{finish}.stl"
                cq.exporters.export(comp, os.path.join(tmp, fn), exportType="STL", tolerance=tol, angularTolerance=0.25)
                try:
                    vol = sum(abs(s.Volume()) for s in comp.Solids())
                except Exception:
                    vol = 0.0
                dens = _metal_density(color) if finish == "metal" else DENSITY.get(finish, 1.2)
                mass += vol / 1000.0 * dens
                groups.append({"file": fn, "finish": finish, "color": color, "volume_mm3": round(vol, 1)})
            big = max(groups, key=lambda g: g["volume_mm3"] if g["finish"] not in ("gold",) else 0)
            term = value(spec, "search", params, "")
            meta = {
                "v": LIB_VERSION, "id": eid, "key": key, "params": params,
                "name": value(spec, "name", params, key), "process": spec.get("process", "bought"),
                "dims": [round(bb.xlen, 2), round(bb.ylen, 2), round(bb.zlen, 2)],
                "bbox_min": [round(bb.xmin, 3), round(bb.ymin, 3), round(bb.zmin, 3)],
                "bbox_max": [round(bb.xmax, 3), round(bb.ymax, 3), round(bb.zmax, 3)],
                "mass_g": round(float(value(spec, "mass", params) or mass), 1),
                "price_usd": value(spec, "price", params, None),
                "supplier": "Amazon" if term and spec.get("process", "bought") == "bought" else "",
                "search": term, "url": search_url(term) if term else "",
                "origin": spec.get("origin", ""), "swatch": big["color"], "groups": groups,
                "built_s": round(time.time() - t0, 2),
            }
            with open(os.path.join(tmp, "meta.json"), "w") as f:
                json.dump(meta, f, indent=1)
            final = os.path.join(r, eid)
            if _valid(final):
                shutil.rmtree(tmp, ignore_errors=True)
            else:
                if os.path.isdir(final):
                    shutil.rmtree(final, ignore_errors=True)
                try:
                    os.rename(tmp, final)
                except OSError:
                    shutil.rmtree(tmp, ignore_errors=True)
            if not quiet:
                print(f"  built {eid} ({meta['built_s']:.1f}s, {len(groups)} finishes) -> {r}")
            return _valid(final) or meta
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            last = e
            continue
    raise RuntimeError(f"could not write the parts cache for {key}: {last}")


def locate(key, params):
    """(dir, meta) of a cached entry, building it on first use."""
    eid = entry_id(key, params)
    for r in _roots():
        d = os.path.join(r, eid)
        meta = _valid(d)
        if meta:
            return d, meta
    meta = build_entry(key, params)
    for r in _roots():
        d = os.path.join(r, eid)
        if _valid(d):
            return d, meta
    raise RuntimeError(f"library part {eid} was built but cannot be read back")


def load(key, params):
    """Cached entry with its meshes: {"meta", "groups": [{"finish", "color", "mesh"}]} (memoised per process)."""
    import trimesh
    eid = entry_id(key, params)
    if eid in _mem:
        return _mem[eid]
    d, meta = locate(key, params)
    groups = []
    for g in meta["groups"]:
        mesh = trimesh.load(os.path.join(d, g["file"]), force="mesh", process=False)
        groups.append({"finish": g["finish"], "color": g["color"], "mesh": mesh})
    ent = {"meta": meta, "groups": groups}
    _mem[eid] = ent
    return ent


def _matrix(at, rot):
    import numpy as np
    from trimesh import transformations as tf
    rx, ry, rz = (float(a) for a in (list(rot) + [0, 0, 0])[:3])
    m = tf.euler_matrix(np.radians(rx), np.radians(ry), np.radians(rz), "sxyz")
    m[:3, 3] = [float(a) for a in at]
    return m


def _is_pt(v):
    return isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(c, (int, float)) for c in v)


def port_at(ent, spec, mat):
    """Where a cable plugs into a placed part: {"type", "at", "dir"} in design mm, or None. The catalog's `port` names
    the connector type and the way out in the part's own frame; the mouth is the centre of the metal shell's outermost
    face that way (so it follows the part however it is moved or rotated)."""
    pt = spec.get("port")
    if not pt:
        return None
    try:
        import numpy as np
        d = np.array(pt["dir"], dtype=float)
        d /= np.linalg.norm(d)
        metal = [g["mesh"].vertices for g in ent["groups"] if g["finish"] == "metal"]
        vs = np.vstack(metal or [g["mesh"].vertices for g in ent["groups"]])
        if pt.get("near") is not None:  # a board with two sockets on one edge: the one near this point
            off = vs - np.array(pt["near"], dtype=float)
            off -= np.outer(off @ d, d)
            keep = np.linalg.norm(off, axis=1) < 5.0
            if keep.any():
                vs = vs[keep]
        proj = vs @ d
        mouth = vs[proj >= proj.max() - 0.35]
        c = (mouth.min(axis=0) + mouth.max(axis=0)) / 2
        # the socket's long side (a USB-C mouth is 8.9 x 3.3): the plug is rolled to match it
        span = mouth.max(axis=0) - mouth.min(axis=0)
        span[np.abs(d) > 0.5] = -1
        w = np.zeros(3)
        w[int(np.argmax(span))] = 1.0
        m = np.asarray(mat, dtype=float)
        at = m[:3, :3] @ c + m[:3, 3]
        dw = m[:3, :3] @ d
        dw /= np.linalg.norm(dw)
        ww = m[:3, :3] @ w
        return {"type": pt["type"], "at": [round(float(x), 2) for x in at], "dir": [round(float(x), 4) for x in dw],
                "wide": [round(float(x), 4) for x in ww]}
    except Exception:
        return None


def place(ent, mats):
    """Sub-part meshes of an entry placed at each 4x4 matrix (all instances merged per finish)."""
    import trimesh
    subs = []
    for g in ent["groups"]:
        copies = []
        for m in mats:
            c = g["mesh"].copy()
            c.apply_transform(m)
            copies.append(c)
        mesh = copies[0] if len(copies) == 1 else trimesh.util.concatenate(copies)
        subs.append({"mesh": mesh, "finish": g["finish"], "color": g["color"]})
    return subs


def part(key, at=(0, 0, 0), rot=(0, 0, 0), name=None, explode=None, color=None, section=None, **params):
    """A library part for parts(). at: one (x, y, z) or a list of them (one BOM line, qty = len); rot: degrees about
    X, Y, Z (applied in that order, about the part's own origin), one for all or one per position. Extra keyword
    arguments are the part's parameters (e.g. length=12 for screws, length=400 for extrusion)."""
    import trimesh
    k, p = resolve(key, params)
    spec = CATALOG[k]
    ats = [tuple(at)] if _is_pt(at) else [tuple(a) for a in at]
    if not ats or not all(_is_pt(a) for a in ats):
        raise ValueError(f"part({key!r}): at must be (x, y, z) or a list of (x, y, z)")
    rots = [tuple(rot)] * len(ats) if _is_pt(rot) else [tuple(r) for r in rot]
    if len(rots) != len(ats) or not all(_is_pt(r) for r in rots):
        raise ValueError(f"part({key!r}): rot must be (rx, ry, rz) or one per position")
    process = spec.get("process", "bought")
    if process != "bought" and len(ats) > 1:
        raise ValueError(f"part({key!r}): place each {key} with its own part() call (each piece is priced separately)")
    ent = load(k, p)
    subs = place(ent, [_matrix(a, r) for a, r in zip(ats, rots)])
    combined = trimesh.util.concatenate([s["mesh"] for s in subs])
    n = len(ats)
    meta = ent["meta"]
    line = bom_line(k, p)
    out = {
        "name": name or (meta["name"] + (f" ×{n}" if n > 1 else "")),
        "shape": combined,
        "process": process,
        "color": color or meta["swatch"],
        "subparts": subs,
        "lib": {"key": k, "id": meta["id"], "params": p, "qty": n, "bom": line, "mass_g": meta.get("mass_g"),
                "at": [list(a) for a in ats], "rot": [list(r) for r in rots]},  # placements: the build's screw checks
    }
    if process == "bought":
        out["group"] = "component"
    elif process == "extrusion":
        out["params"] = {"profile": str(p["profile"]), "length_mm": float(p["length"])}
    if explode is not None:
        out["explode"] = explode
    if section:  # the Parts panel groups by machine section ("Y axis", "Electronics")
        out["section"] = section
    port = port_at(ent, spec, _matrix(ats[0], rots[0]))  # the viewer plugs its cable in here (decoration only)
    if port:
        out["port"] = port
    return out


def info(key, **params):
    """Cached metadata for a part: dims, bbox_min/max, origin, mass_g, price_usd, url..."""
    k, p = resolve(key, params)
    return dict(locate(k, p)[1])


# ---------------------------------------------------------------- fab.py placeholders -> detailed models

def tag(w, key, params):
    """Remember on a fab placeholder Workplane which library part it stands for (survives translate / rotate)."""
    try:
        vals = w.vals()
        if len(vals) == 1:
            w.ctx._buildery_lib = (key, dict(params), [v.toTuple() for v in vals[0].Vertices()])
    except Exception:
        pass
    return w


def tagged_subparts(shape, name=""):
    """For build.py: if `shape` is an untouched (only moved / rotated) fab placeholder, the detailed library sub-parts
    at the same placement, else None. Never raises."""
    t = _tagged(shape, name)
    return place(load(t[0], t[1]), [t[2]]) if t else None


def tagged_port(shape, name=""):
    """For build.py: the cable port (see port_at) of an untouched fab placeholder, else None. Never raises."""
    try:
        t = _tagged(shape, name)
        return port_at(load(t[0], t[1]), CATALOG[t[0]], t[2]) if t else None
    except Exception:
        return None


def _tagged(shape, name=""):
    """(key, params, 4x4 placement) of an untouched fab placeholder, else None."""
    try:
        t = getattr(getattr(shape, "ctx", None), "_buildery_lib", None)
        if not t:
            return None
        import numpy as np
        key, params, orig = t
        if key == "ws2812_strip" and re.search(r"\bcob\b", str(name), re.I):
            return None  # fab.led_strip also stands in for COB strips
        vals = shape.vals()
        if len(vals) != 1:
            return None
        cur = np.array([v.toTuple() for v in vals[0].Vertices()], dtype=float)
        orig = np.array(orig, dtype=float)
        if cur.shape != orig.shape or len(orig) < 4:
            return None
        X = np.hstack([orig, np.ones((len(orig), 1))])
        sol, _, rank, _ = np.linalg.lstsq(X, cur, rcond=None)
        if rank < 4 or np.abs(X @ sol - cur).max() > 1e-3:
            return None  # booleans / edits changed the placeholder: keep it as it is
        m = np.eye(4)
        m[:3, :3] = sol[:3].T
        m[:3, 3] = sol[3]
        k, p = resolve(key, params)
        load(k, p)  # a missing cache entry is reported here, not later
        return k, p, m
    except Exception as e:  # a missing cache entry must never fail a build that used to work
        print(f"  note: detailed model for a fab placeholder unavailable ({type(e).__name__}: {e})")
        return None


def catalog_text():
    """One line per key: key (params) name, origin, price."""
    lines = []
    for k in KEYS:
        s = CATALOG[k]
        d = s.get("defaults", {})
        ps = ", ".join(f"{a}={b!r}" for a, b in d.items() if a not in s.get("locked", ()))
        pr = value(s, "price", d, None)
        lines.append(f"{k}({ps})  {value(s, 'name', d, k)}  [{s.get('origin', '')}]" + (f"  ~${pr}" if pr else ""))
    return "\n".join(lines)


if __name__ == "__main__":
    print(catalog_text())
