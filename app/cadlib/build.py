"""Build a design dir:  python -m cadlib.build <design_dir> [--no-thumb]

Imports <design_dir>/design.py, calls parts(), and writes
  stl/<slug>.stl, bom.json["printed"], manifest.json (last, atomic), thumb.png, build_log.txt.

parts() returns a list of dicts:
  {"name": str, "shape": cq.Workplane | cq.Shape | trimesh.Trimesh | "path/to/file.stl",
   "group": "case" | "component", "color": "#rrggbb" (opt), "explode": [x,y,z] (opt), "slug": str (opt),
   "process": "print" | "extrusion" | "sheet" | "laser" | "bought" (opt; default print for case, bought for component),
   "ref_model": {...} (opt; set by cadlib.refmodels.ref(): the viewer shows that vetted reference model, display only),
   "params": {...} (opt; extrusion {profile, length_mm}, sheet {material, thickness_mm, bends}, laser {material, thickness_mm}),
   "material": "acrylic_clear" | "aluminium" | "wood" ... (opt, cadlib/look.py MATERIALS; inferred from process/params),
   "engrave": {...} (opt, from cadlib.look.engrave_text), "cable": {type, at, dir, length_mm} (opt, decoration only),
   "port": {type, at, dir, wide} (set by cadlib.parts.part() for boards / jacks: the connector's mouth, placed with the part;
   the viewer plugs the cable in here, so it follows the board when the design moves or rotates it),
   "pieces": n (opt; a made part that really is n separate solids: no 'separate pieces' warning),
   "section": str (opt; the machine section it belongs to, e.g. "Frame", "Y axis", "Electronics": the Parts panel groups by it)}
Optional module constant CABLES = [{type, at, dir, length_mm}, ...] -> manifest["cables"] (False: no automatic cable).
Only "print" parts go into bom.json["printed"]; extrusion/sheet/laser parts go into bom.json["fabricated"].
Library parts (cadlib.parts.part(...)) also carry "subparts" (per-finish meshes, exported as stl/<slug>__<i>.stl and
listed in the manifest) and "lib" (their bought-part line, merged into bom.json["parts"] marked "auto": "lib").
fab.py placeholders (fab.nema17() ...) that were only moved / rotated get the same detailed sub-part meshes.
Optional motion() -> sampled by cadlib/motion.py into motion.json (per moving part, per frame: pos + quat relative to the
built pose) for the viewer's Move button; listed in manifest["motion"]. A part's optional "id" names it for motion().
Optional "fx" per part: {"glow": {"color": "#rrggbb" | "rainbow", "mode": "solid" | "rainbow" | "pulse"},
  "screen": {"text": str, "bg": "#rrggbb", "fg": "#rrggbb", "face": "+x".."-z"}, "spin": {"axis": [x,y,z], "rpm": n,
  "center": [x,y,z]}} (each may also be true); cleaned by clean_fx() and passed to the manifest for the viewer's power toggle.
Optional module constant THUMB_VIEW = "iso" | "iso_low" | "iso_back" | "front" | "side" | "top" picks the thumbnail camera.
Optional SCENE = "desk" | "wall" | "counter" | "shelf" | "handlebar" | "floor" (manifest["scene"]: the viewer's Scene
context) and SCENE_FACE = "-z" | "+y" | ... (the face that sits on / against it; default bottom, or back = +Y on a wall).
Optional ASSEMBLY = [["Base"], ["PCB", "Button"], ["Lid"], ["M3x10 screw"]] (steps of part names, in order) ->
manifest["assembly_order"] for the viewer's Assemble animation; a part dict's "step": n does the same per part.
After the manifest, fit_checks() warns about parts that overlap (optional TOUCHING = [("Lid", "Body"), "Phone (yours)"]
allows an intended press fit) and about library screws with no hole under them or no screwdriver path above them.
Exit code 0 on success, 1 on failure (readable error in build_log.txt).
"""
import importlib.util
import io
import json
import math
import os
import re
import subprocess
import sys
import time
import traceback

from cadlib import look

BED = 256.0
STL_TOL = 0.1
STL_ANG = 0.2
CASE_COLORS = ["#5aa9ff", "#6fbf73", "#ffb347", "#c9ccd2", "#9b8cff", "#ff7b7b", "#4dd0c8", "#e0a96d"]
COMP_COLOR = "#8a8f98"
PROCESSES = ("print", "extrusion", "sheet", "laser", "bought")
FAB_PROCESSES = ("extrusion", "sheet", "laser")
METALS = ("aluminium", "aluminum", "steel", "stainless", "brass", "copper")  # rmfg: modelled parts in these get a STEP file
PROCESS_COLORS = {"extrusion": "#b8bec7", "sheet": "#a9b1bb", "laser": "#d8ecf5"}
SHEET_MAX = (600.0, 300.0)     # small-shop sheet-metal blank limit (mm)
LASER_BED = (600.0, 400.0)     # assumed laser bed (mm)
EXTRUSION_MAX = 1500.0         # longest stock length we plan around (mm)
# rough material cost for the fabricated estimate (USD); the quote prices it in server/pricing_fab.js
EXTRUSION_USD_PER_M = {"2020": 6.0, "2040": 10.0, "3030": 11.0, "4040": 16.0}
SHEET_USD_PER_CM2_MM = {"aluminium": 0.004, "aluminum": 0.004, "steel": 0.0015, "stainless": 0.005}
LASER_USD_PER_CM2_MM = {"acrylic": 0.0035, "plywood": 0.0012, "mdf": 0.0008}


class Tee(io.TextIOBase):
    def __init__(self, *streams):
        self.streams = streams

    def write(self, s):
        for st in self.streams:
            try:
                st.write(s)
            except Exception:
                pass
        return len(s)

    def flush(self):
        for st in self.streams:
            try:
                st.flush()
            except Exception:
                pass


class BuildError(Exception):
    pass


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    return s or "part"


BUILD_MEM_MB = int(os.environ.get("FORMA_BUILD_MEM_MB") or 6144)
_mem_guard_on = False


def mem_guard(limit_mb=BUILD_MEM_MB):
    """Security C4: macOS doesn't enforce RLIMIT_AS, so a daemon thread ends the build once its peak memory passes
    limit_mb (a runaway design.py can't swap the Mac to a halt). Started once per build process (the warm worker's
    forked child, or the cold build.sh process)."""
    global _mem_guard_on
    if _mem_guard_on or limit_mb <= 0:
        return
    _mem_guard_on = True
    import resource
    import threading
    scale = 1 if sys.platform == "darwin" else 1024  # ru_maxrss: bytes on macOS, KiB on Linux

    def watch():
        while True:
            if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale > limit_mb * 1048576:
                try:
                    print(f"\nBUILD FAILED: design.py used more than {limit_mb} MB of memory, so the build was stopped.", file=sys.stderr, flush=True)
                finally:
                    os._exit(137)
            time.sleep(0.25)
    threading.Thread(target=watch, daemon=True, name="mem-guard").start()


def load_design(design_dir):
    mem_guard()
    path = os.path.join(design_dir, "design.py")
    if not os.path.isfile(path):
        raise BuildError(f"design.py not found in {design_dir}")
    mod_name = f"_design_{abs(hash(path))}_{int(time.time() * 1000)}"
    spec = importlib.util.spec_from_file_location(mod_name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, design_dir)
    try:
        spec.loader.exec_module(mod)
    finally:
        try:
            sys.path.remove(design_dir)
        except ValueError:
            pass
    if not hasattr(mod, "parts") or not callable(mod.parts):
        raise BuildError("design.py must define a function parts() -> list[dict]")
    return mod


def to_cq_shape(shape):
    """Return a single cq.Shape for a Workplane/Shape, or None if it's a mesh/path."""
    import cadquery as cq
    if isinstance(shape, cq.Workplane):
        vals = [v for v in shape.vals() if isinstance(v, cq.Shape)]
        if not vals:
            raise BuildError("Workplane has no solids (empty result - check booleans/selectors)")
        return vals[0] if len(vals) == 1 else cq.Compound.makeCompound(vals)
    if isinstance(shape, cq.Assembly):
        return shape.toCompound()
    if isinstance(shape, cq.Shape):
        return shape
    return None


def to_mesh(shape, design_dir):
    import trimesh
    if isinstance(shape, trimesh.Trimesh):
        return shape
    if isinstance(shape, (str, os.PathLike)):
        p = shape if os.path.isabs(shape) else os.path.join(design_dir, shape)
        m = trimesh.load(p, force="mesh")
        return m
    raise BuildError(f"unsupported shape type {type(shape).__name__} (use cq.Workplane, cq.Shape, trimesh.Trimesh or an .stl path)")


def solid_volume_mm3(s):
    try:
        sols = s.Solids()
        if sols:
            return sum(abs(x.Volume()) for x in sols)
        return abs(s.Volume())
    except Exception:
        return 0.0


def export_part(part, design_dir, stl_dir, slug):
    """Export one part; return (bbox list, volume mm3, center xyz)."""
    out = os.path.join(stl_dir, slug + ".stl")
    tmp = os.path.join(stl_dir, f".{slug}.tmp.stl")
    s = to_cq_shape(part["shape"])
    if s is not None:
        import cadquery as cq
        if not s.isValid():
            print(f"  warning: '{part['name']}' shape is not valid (OCC check); exporting anyway")
        cq.exporters.export(s, tmp, exportType="STL", tolerance=STL_TOL, angularTolerance=STL_ANG)
        bb = s.BoundingBox()
        bbox = [bb.xlen, bb.ylen, bb.zlen]
        center = [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2]
        lo, hi = [bb.xmin, bb.ymin, bb.zmin], [bb.xmax, bb.ymax, bb.zmax]
        vol = solid_volume_mm3(s)
        part["_cq"] = s
    else:
        m = to_mesh(part["shape"], design_dir)
        m.export(tmp, file_type="stl")
        lo, hi = m.bounds[0].tolist(), m.bounds[1].tolist()
        bbox = [hi[i] - lo[i] for i in range(3)]
        center = [(lo[i] + hi[i]) / 2 for i in range(3)]
        vol = abs(float(m.volume)) if m.is_volume else abs(float(m.convex_hull.volume)) * 0.6
    if os.path.getsize(tmp) < 200:
        os.remove(tmp)
        raise BuildError(f"part '{part['name']}' exported an empty mesh")
    os.replace(tmp, out)
    return [round(v, 1) for v in bbox], vol, center, lo, hi


def _vol_text(v):
    return f"{v:.0f} mm³" if v < 1000 else f"{v / 1000:.1f} cm³"


def pieces_warning(name, s, allowed=None):
    """A made part that is several disconnected solids prints / cuts as loose bits: the warning text, else None.
    Solids that touch count as one piece; slivers under 1 mm³ (and under 0.2% of the biggest solid) are ignored.
    A part dict's "pieces": n allows n pieces on purpose."""
    try:
        sols = s.Solids()
        if len(sols) < 2:
            return None
        vols = [abs(x.Volume()) for x in sols]
        big = max(vols)
        idx = [i for i, v in enumerate(vols) if v >= max(1.0, 0.002 * big)]
        if len(idx) < 2:
            return None
        bbs = {i: sols[i].BoundingBox() for i in idx}
        parent = {i: i for i in idx}

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        calls = 0
        for a in idx:
            for b in idx:
                if b <= a or root(a) == root(b):
                    continue
                A, B = bbs[a], bbs[b]
                if (A.xmin > B.xmax + 0.01 or B.xmin > A.xmax + 0.01 or A.ymin > B.ymax + 0.01 or B.ymin > A.ymax + 0.01
                        or A.zmin > B.zmax + 0.01 or B.zmin > A.zmax + 0.01):
                    continue
                calls += 1
                if calls > 60 or sols[a].distance(sols[b]) < 0.01:  # too many to measure: boxes touching is enough
                    parent[root(b)] = root(a)
        groups = {}
        for i in idx:
            groups.setdefault(root(i), []).append(i)
        n = len(groups)
        if n < 2 or (isinstance(allowed, (int, float)) and not isinstance(allowed, bool) and n <= allowed):
            return None
        gs = sorted(groups.values(), key=lambda g: -sum(vols[i] for i in g))
        desc = []
        for k, g in enumerate(gs[1:4], start=2):
            lo = [min(getattr(bbs[i], a + "min") for i in g) for a in "xyz"]
            hi = [max(getattr(bbs[i], a + "max") for i in g) for a in "xyz"]
            c = [(lo[j] + hi[j]) / 2 for j in range(3)]
            desc.append(f"piece {k}: {_vol_text(sum(vols[i] for i in g))} at x {round(c[0])}, y {round(c[1])}, z {round(c[2])}")
        more = f", +{n - 4} more" if n > 4 else ""
        return (f"'{name}' is {n} separate pieces (main {_vol_text(sum(vols[i] for i in gs[0]))}; {'; '.join(desc)}{more}), "
                f"so it comes out as loose bits. Sink each feature into the body and union it "
                f"(or set \"pieces\": {n} on the part if that is intended).")
    except Exception:
        return None


FINISHES = ("pcb", "metal", "gold", "plastic", "rubber", "glass")


def export_subparts(subs, stl_dir, slug):
    """Write each library sub-part mesh as stl/<slug>__<i>.stl; return the manifest entries."""
    out = []
    for i, s in enumerate(subs):
        fn = f"{slug}__{i}.stl"
        tmp = os.path.join(stl_dir, f".{fn}.tmp")
        s["mesh"].export(tmp, file_type="stl")
        os.replace(tmp, os.path.join(stl_dir, fn))
        fin = s.get("finish") if s.get("finish") in FINISHES else "plastic"
        out.append({"file": f"stl/{fn}", "color": str(s.get("color") or COMP_COLOR).lower(), "finish": fin})
    return out


def lib_bom(rows, bom):
    """Merge library parts' bought lines into bom["parts"] (marked "auto": "lib"; a hand-written line of the same
    name wins, so nothing is counted twice)."""
    agg = {}
    for r in rows:
        lib = r.get("lib") or {}
        line = lib.get("bom")
        if not line:
            continue
        a = agg.setdefault(line["name"], dict(line, qty_per_unit=0))
        a["qty_per_unit"] += int(lib.get("qty") or 1)
    manual = [p for p in bom.get("parts", []) if isinstance(p, dict) and p.get("auto") != "lib"]
    names = {str(p.get("name", "")).strip().lower() for p in manual}
    auto = []
    for name, a in agg.items():
        if name.strip().lower() in names:
            continue
        auto.append({"name": name, "qty_per_unit": a["qty_per_unit"], "unit_cost_usd": a["unit_cost_usd"],
                     "supplier": a.get("supplier", ""), "url": a.get("url", ""), "notes": a.get("notes", ""), "auto": "lib"})
    bom["parts"] = manual + auto
    return auto


def norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return [round(c / n, 3) for c in v] if n > 1e-9 else [0.0, 0.0, 1.0]


def atomic_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def build(design_dir, thumb=True):
    t0 = time.time()
    design_dir = os.path.abspath(design_dir)
    stl_dir = os.path.join(design_dir, "stl")
    os.makedirs(stl_dir, exist_ok=True)
    from cadlib import dims
    dims.reset_used()
    mod = load_design(design_dir)
    print(f"loaded design.py ({time.time() - t0:.1f}s)")
    raw = mod.parts()
    if dims.USED:
        print("sizes from cadlib.dims (cite these in your reply):")
        for line in dims.used_report():
            print("  " + line)
    if not isinstance(raw, (list, tuple)) or not raw:
        raise BuildError("parts() must return a non-empty list of dicts")
    print(f"parts() returned {len(raw)} parts ({time.time() - t0:.1f}s)")

    used, rows, names_used, raw_steps = set(), [], set(), []
    ci = 0
    for i, p in enumerate(raw):
        if not isinstance(p, dict) or "shape" not in p:
            raise BuildError(f"parts()[{i}] must be a dict with at least 'name' and 'shape'")
        name = str(p.get("name") or f"Part {i + 1}")
        if isinstance(p.get("lib"), dict) and name in names_used:  # library parts placed twice under one name
            base_n, k2 = name, 2
            while name in names_used:
                name = f"{base_n} ({k2})"; k2 += 1
        names_used.add(name)
        process = p.get("process")
        if process is not None and process not in PROCESSES:
            raise BuildError(f"part '{name}': process must be one of {', '.join(PROCESSES)}, got {process!r}")
        group = p.get("group") or ("component" if process == "bought" else "case")
        if group not in ("case", "component"):
            raise BuildError(f"part '{name}': group must be 'case' or 'component', got {group!r}")
        process = process or ("print" if group == "case" else "bought")
        params = p.get("params") if isinstance(p.get("params"), dict) else {}
        slug = slugify(p.get("id") or p.get("slug") or name)
        base, k = slug, 2
        while slug in used:
            slug = f"{base}-{k}"; k += 1
        used.add(slug)
        color = p.get("color")
        if not (isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
            if process in PROCESS_COLORS:
                color = PROCESS_COLORS[process]
            elif group == "case":
                color = CASE_COLORS[ci % len(CASE_COLORS)]; ci += 1
            else:
                color = COMP_COLOR
        subs = p.get("subparts") if isinstance(p.get("subparts"), list) else None
        port = p.get("port") if isinstance(p.get("port"), dict) else None  # parts.part(): where its cable plugs in
        if subs is None and group == "component":
            from cadlib import parts as libparts
            subs = libparts.tagged_subparts(p["shape"], name)  # fab.py placeholder -> detailed library model
            if subs and port is None:
                port = libparts.tagged_port(p["shape"], name)
        try:
            bbox, vol, center, lo, hi = export_part(p, design_dir, stl_dir, slug)
            sub_files = export_subparts(subs, stl_dir, slug) if subs else None
        except BuildError:
            raise
        except Exception as e:
            raise BuildError(f"part '{name}' failed to export: {type(e).__name__}: {e}") from e
        lib = p.get("lib") if isinstance(p.get("lib"), dict) else None
        material = look.norm_material(p.get("material"))
        if p.get("material") and not material:
            print(f"  warning: part '{name}': unknown material {p.get('material')!r} (use one of {', '.join(look.MATERIALS)})")
        material = material or (look.infer_material(process, params) if group == "case" else None)
        engrave = look.norm_engrave(p.get("engrave"))
        cable = look.norm_cable(p.get("cable")) if p.get("cable") else None
        if p.get("cable") and not cable:
            print(f"  warning: part '{name}': cable needs at: [x, y, z] and dir: [x, y, z]; ignored")
        ref_model = p.get("ref_model") if isinstance(p.get("ref_model"), dict) and process == "bought" else None
        if ref_model:
            print(f"  reference model {ref_model.get('key')} for '{name}' (display only: not printed, not in downloads or the price)")
        wide = look._vec3(port.get("wide")) if port else None
        port = look.norm_cable(port) if port else None
        if port:
            port.pop("length_mm", None)
            if wide:
                port["wide"] = [round(x, 4) for x in wide]
        rows.append(dict(name=name, material=material, engrave=engrave, cable=cable, port=port, raw_name=str(p.get("name") or name), group=group, process=process, params=params, slug=slug, color=color.lower(),
                         bbox=bbox, vol=vol, center=center, lo=lo, hi=hi, explode=p.get("explode"), cq=p.pop("_cq", None),
                         subparts=sub_files, lib=lib, fx=clean_fx(p.get("fx"), name), ref_model=ref_model,
                         section=clean_section(p.get("section"))))
        if isinstance(p.get("step"), (int, float)) and not isinstance(p.get("step"), bool):
            raw_steps.append((float(p["step"]), name))
        print(f"  {process:9s} {slug:28s} {bbox[0]:6.1f} x {bbox[1]:6.1f} x {bbox[2]:6.1f} mm")
        if process != "bought" and rows[-1]["cq"] is not None:
            w = pieces_warning(name, rows[-1]["cq"], p.get("pieces"))
            if w:
                print(f"  WARNING: {w}")

    # default explode = away from assembly centre
    lo = [min(r["lo"][i] for r in rows) for i in range(3)]
    hi = [max(r["hi"][i] for r in rows) for i in range(3)]
    mid = [(lo[i] + hi[i]) / 2 for i in range(3)]
    for r in rows:
        ex = r["explode"]
        if isinstance(ex, (list, tuple)) and len(ex) == 3:
            r["explode"] = [float(x) for x in ex]
        else:
            r["explode"] = norm([r["center"][i] - mid[i] for i in range(3)]) if len(rows) > 1 else [0.0, 0.0, 0.0]

    # rmfg: STEP files for metal parts a sheet/tube shop (RMFG) quotes from CAD: sheet and extrusion parts, and our
    # own modelled metal parts (e.g. a machined or laser-cut tube the design calls "bought"). Library parts are skipped.
    step_dir = os.path.join(design_dir, "step")
    step_keep = set()
    for r in rows:
        metal = r["process"] in ("sheet", "extrusion") or (not r.get("lib") and str(r.get("material") or "").lower() in METALS)
        if not metal or r.get("cq") is None:
            continue
        try:
            import cadquery as cq
            os.makedirs(step_dir, exist_ok=True)
            fn = r["slug"] + ".step"
            tmp = os.path.join(step_dir, "." + fn)
            cq.exporters.export(r["cq"], tmp, exportType="STEP")
            os.replace(tmp, os.path.join(step_dir, fn))
            r["step"] = f"step/{fn}"
            step_keep.add(fn)
        except Exception as e:
            print(f"  warning: could not export STEP for '{r['name']}' ({type(e).__name__}: {e})")
    if os.path.isdir(step_dir):
        for fn in os.listdir(step_dir):
            if fn.endswith(".step") and fn not in step_keep:
                try: os.remove(os.path.join(step_dir, fn))
                except OSError: pass

    # remove stale STLs
    keep = {r["slug"] + ".stl" for r in rows}
    keep |= {os.path.basename(s["file"]) for r in rows for s in (r.get("subparts") or [])}
    for fn in os.listdir(stl_dir):
        if fn.endswith(".stl") and fn not in keep:
            try:
                os.remove(os.path.join(stl_dir, fn))
                print(f"  removed stale stl/{fn}")
            except OSError:
                pass

    motion = write_motion(mod, rows, design_dir)

    # colour picks from the studio (meta.json "colors": {part name: "#rrggbb"}, set from the viewer's hover tooltip, no AI run):
    # they override the design's colour on printed parts and survive every rebuild.
    picks = {}
    try:
        with open(os.path.join(design_dir, "meta.json")) as f:
            picks = json.load(f).get("colors") or {}
    except Exception:
        pass
    for r in rows:
        c = picks.get(r["name"]) if isinstance(picks, dict) else None
        if r["process"] == "print" and isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c):
            r["design_color"], r["color"] = r["color"], c.lower()

    # print estimate + bom.json
    printed, tot_g, tot_h = [], 0.0, 0.0
    for r in rows:
        if r["process"] != "print":
            continue
        cm3 = r["vol"] / 1000.0
        g = max(2.0, cm3 * 1.27 * 0.55)
        h = max(0.25, g / 20.0)
        tot_g += g; tot_h += h
        printed.append({"file": f"stl/{r['slug']}.stl", "name": r["name"], "grams": round(g, 1),
                        "print_hours": round(h, 2), "bbox": r["bbox"]})
        if r.get("design_color"):
            printed[-1]["color"] = r["color"]  # the customer's colour pick: printed in this filament
        if max(r["bbox"]) > BED:
            print(f"  WARNING: printed part '{r['name']}' is {max(r['bbox']):.1f} mm, exceeds the {BED:.0f} mm bed")
    bom_path = os.path.join(design_dir, "bom.json")
    bom = {}
    if os.path.isfile(bom_path):
        try:
            with open(bom_path) as f:
                bom = json.load(f)
            if not isinstance(bom, dict):
                bom = {}
        except Exception as e:
            print(f"  warning: bom.json unreadable ({e}); rewriting printed list only")
            bom = {}
    bom.setdefault("parts", [])
    bom.setdefault("assembly_minutes", 10)
    bom.setdefault("kit_ok", True)
    # electronics strategy: solderless by default; soldering is flagged (checkout offers an iron) with a one-line reason
    bom["needs_soldering"] = bom.get("needs_soldering") is True
    if bom["needs_soldering"] and not str(bom.get("soldering_reason") or "").strip():
        print('  WARNING: bom.json "needs_soldering" is true but there is no "soldering_reason" (one short sentence)')
    if not bom["needs_soldering"]:
        bom.pop("soldering_reason", None)
    fabricated = []
    for r in rows:
        if r["process"] not in FAB_PROCESSES:
            continue
        try:
            est, params = fab_estimate(r)
        except Exception as e:
            print(f"  warning: could not estimate '{r['name']}' ({type(e).__name__}: {e})")
            est, params = {"minutes": 10}, r["params"]
        fabricated.append({"file": f"stl/{r['slug']}.stl", "name": r["name"], "process": r["process"],
                           "params": params, "est": est, "bbox": r["bbox"]})
    bom["printed"] = printed
    bom["fabricated"] = fabricated
    auto = lib_bom(rows, bom)
    if auto:
        listed = ", ".join(f"{a['qty_per_unit']} x {a['name']}" for a in auto)
        print(f"library parts: {len(auto)} bought lines in bom.json ({listed})")
    atomic_json(bom_path, bom)
    print(f"print estimate: {len(printed)} printed parts, {tot_g:.0f} g, {tot_h:.1f} h")
    if fabricated:
        fm = sum(f["est"].get("minutes", 0) for f in fabricated)
        fu = sum(f["est"].get("material_usd", 0) for f in fabricated)
        print(f"fabrication estimate: {len(fabricated)} parts, ~{fm:.0f} shop min, ~${fu:.2f} stock "
              f"(priced in the quote from process params; no bom parts lines needed)")

    # manifest LAST
    title = None
    try:
        with open(os.path.join(design_dir, "meta.json")) as f:
            title = json.load(f).get("title")
    except Exception:
        pass
    title = title or getattr(mod, "TITLE", None) or os.path.basename(design_dir)
    manifest = {"t": time.time(), "title": title, "parts": [manifest_part(r) for r in rows]}
    cables = getattr(mod, "CABLES", None)
    if cables is False:
        manifest["cables"] = False
    elif isinstance(cables, (list, tuple, dict)):
        cl = [look.norm_cable(c) for c in (cables if isinstance(cables, (list, tuple)) else [cables])]
        manifest["cables"] = [c for c in cl if c]

    scene_meta(mod, raw_steps, rows, manifest)
    from cadlib import wiring  # pin-to-pin list: every wire's parts must exist (checked after the manifest is written)
    w_err, w_warn, w_sum = wiring.check(design_dir, rows, bom)
    for w in w_warn:
        print(f"  WARNING: {w}")
    if w_sum:
        manifest["wiring"] = dict(w_sum, ok=not w_err)
    if motion:
        manifest["motion"] = {"file": "motion.json", "duration": motion["duration"], "frames": motion["frames"],
                              "parts": len(motion["parts"])}
    atomic_json(os.path.join(design_dir, "manifest.json"), manifest)
    print(f"manifest written ({time.time() - t0:.1f}s)")
    if w_sum and not w_err:
        print(f"wiring: {w_sum['wires']} wires between {len(w_sum['parts'])} parts")
    fit_checks(design_dir, mod, rows, manifest)
    if w_err:
        raise BuildError("wiring.json does not match the design (the model was exported; fix the list and build again):\n  "
                         + "\n  ".join(w_err[:20]))

    if thumb and os.environ.get("FORMA_NO_RENDER") == "1":
        # Sandboxed agent builds can't open a render window; the Forma server renders thumb.png after the build.
        print("thumb.png: rendered by the server after this build")
    elif thumb:
        view = getattr(mod, "THUMB_VIEW", "iso")
        render_thumb_subprocess(design_dir, view=view if isinstance(view, str) else "iso")
    print(f"build ok in {time.time() - t0:.1f}s")


FASTENERS = ("shcs", "bhcs", "csk", "selftap", "insert")  # sit in holes on purpose: no overlap check (screws: own check)
SCREW_KEYS = ("shcs", "bhcs", "csk", "selftap")


def _stl_tris(design_dir, r):
    from cadlib.views import read_stl
    import numpy as np
    t = read_stl(os.path.join(design_dir, "stl", r["slug"] + ".stl")).astype(np.float64)
    return t


def _touching(mod):
    """TOUCHING = [("Lid", "Body"), "Phone (yours)"]: pairs (or single parts) allowed to overlap."""
    out = set()
    for t in getattr(mod, "TOUCHING", None) or ():
        if isinstance(t, str):
            out.add(t)
        elif isinstance(t, (list, tuple)) and len(t) == 2:
            out.add(frozenset(str(x) for x in t))
    return out


def fit_checks(design_dir, mod, rows, manifest):
    """Parts that overlap each other, screws without a hole or a screwdriver path. Mesh-only (cadlib/meshcheck.py,
    numpy): only ever prints warnings, never fails or crashes the build."""
    t = time.time()
    try:
        from cadlib import meshcheck
        import numpy as np
        tris = {}  # by row index: two parts may share a name
        for i, r in enumerate(rows):
            try:
                tris[i] = _stl_tris(design_dir, r)
            except Exception:
                pass
        names = {r["name"] for r in rows}
        allowed = _touching(mod)
        for a in allowed:
            for n in ([a] if isinstance(a, str) else a):
                if n not in names:
                    print(f"  WARNING: TOUCHING names an unknown part {n!r}")
        key = lambda r: str((r.get("lib") or {}).get("key") or "")
        items = []
        for i, r in enumerate(rows):
            if i in tris and len(tris[i]) and key(r) not in FASTENERS:
                lo, hi = meshcheck.bbox(tris[i])
                items.append((r["name"], tris[i], lo, hi))
        bought = {r["name"] for r in rows if r["process"] == "bought"}
        hits, st = meshcheck.interference(items, allowed, bought=bought)
        for h in hits:
            lo, hi = h["lo"], h["hi"]
            at = ", ".join(f"{c} {round(float(lo[i]))}..{round(float(hi[i]))}" for i, c in enumerate("xyz"))
            print(f"  WARNING: '{h['a']}' overlaps '{h['b']}' by {_vol_text(h['vol'])} at {at}: move or resize one, "
                  f"or cut a pocket (an intended press fit goes in TOUCHING)")
        n = len(items)
        msg = (f"overlap check: {st['pairs']} of {n * (n - 1) // 2} part pairs touch or overlap, {st['checked']} checked, "
               f"{len(hits)} overlapping")
        if st["timed_out"]:
            msg += f", {st['timed_out']} NOT checked (time limit)"
        screws = []
        for r in rows:
            lib = r.get("lib") or {}
            if key(r) not in SCREW_KEYS or not lib.get("at"):
                continue
            from cadlib.parts import models, _matrix
            p = lib.get("params") or {}
            d, L = float(p.get("d", 3)), float(p.get("length", 10))
            dk = {"shcs": models.SHCS, "bhcs": models.BHCS, "csk": models.CSK, "selftap": models.PAN}[key(r)]
            hd = dk.get(int(d) if d == int(d) else d) or (2 * d, 0.6 * d)
            head_d, head_h = float(hd[0]), (0.0 if key(r) == "csk" else float(hd[1]))
            rots = lib.get("rot") or [(0, 0, 0)] * len(lib["at"])
            for i, (a, ro) in enumerate(zip(lib["at"], rots)):
                m = _matrix(a, ro)
                label = r["name"] if len(lib["at"]) == 1 else f"{r['name']} #{i + 1}"
                screws.append(dict(name=r["name"], label=label, at=m[:3, 3], axis=m[:3, 2], d=d, length=L,
                                   head_d=head_d, head_h=head_h))
        if screws:
            made = ("print", "sheet", "laser", "extrusion")
            parts = [dict(name=r["name"], tris=tris[i], made=r["process"] in made,
                          blocks=key(r) not in FASTENERS and not (r.get("ref_model") or {}).get("yours"))
                     for i, r in enumerate(rows) if i in tris and len(tris[i]) and key(r) not in SCREW_KEYS]
            order = {n: i for i, step in enumerate(manifest.get("assembly_order") or []) for n in step} or None
            for w in meshcheck.screw_checks(screws, parts, order):
                print(f"  WARNING: {w}")
            msg += f"; {len(screws)} screws checked for a hole and a screwdriver path"
        print(f"{msg} ({time.time() - t:.1f}s)")
    except Exception as e:  # a checker bug must never cost the user a build
        print(f"  (fit checks skipped: {type(e).__name__}: {e})")


def write_motion(mod, rows, design_dir):
    """Sample design.py's optional motion() into motion.json (written before the manifest that points at it).
    A broken motion() never fails the build: it warns and the Move button stays off."""
    path = os.path.join(design_dir, "motion.json")
    fn = getattr(mod, "motion", None)
    data = None
    if callable(fn):
        t = time.time()
        try:
            from cadlib import motion as cmotion
            data, warns = cmotion.sample(fn(), rows)
            for w in warns:
                print(f"  WARNING: {w}")
        except Exception as e:
            where = ""
            for fr in traceback.extract_tb(e.__traceback__):
                if os.path.basename(fr.filename) == "design.py":
                    where = f" (design.py line {fr.lineno}: {fr.line})"
            print(f"  WARNING: motion() failed, no Move button this build: {type(e).__name__}: {e}{where}")
            data = None
        if data:
            with open(path + ".tmp", "w") as f:
                json.dump(data, f, separators=(",", ":"))
            os.replace(path + ".tmp", path)
            print(f"motion: {len(data['parts'])} moving parts, {data['frames']} frames over {data['duration']:g} s "
                  f"({time.time() - t:.2f}s)")
            return data
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    return None


_HEX = re.compile(r"#[0-9a-fA-F]{6}")


def clean_fx(fx, name="part"):
    """A part's "fx" (viewer power effects: glow / screen / spin), cleaned for the manifest. None when absent or unusable;
    {} (an explicit "no effects") is kept. Bad values are dropped with a printed note, never a build failure."""
    if fx is None:
        return None
    if not isinstance(fx, dict):
        print(f"  fx: part '{name}': fx must be a dict, ignored")
        return None
    out = {}

    def vec(v):
        if isinstance(v, (list, tuple)) and len(v) == 3:
            try:
                return [float(x) for x in v]
            except (TypeError, ValueError):
                return None
        return None

    g = fx.get("glow")
    if g is True:
        out["glow"] = {}
    elif isinstance(g, dict):
        o = {}
        c = g.get("color")
        if c == "rainbow" or (isinstance(c, str) and _HEX.fullmatch(c)):
            o["color"] = c.lower()
        if g.get("mode") in ("solid", "rainbow", "pulse"):
            o["mode"] = g["mode"]
        out["glow"] = o
    sc = fx.get("screen")
    if sc is True:
        out["screen"] = {}
    elif isinstance(sc, dict):
        o = {}
        if isinstance(sc.get("text"), str):
            o["text"] = sc["text"][:80]
        for k in ("bg", "fg"):
            if isinstance(sc.get(k), str) and _HEX.fullmatch(sc[k]):
                o[k] = sc[k].lower()
        if isinstance(sc.get("face"), str) and re.fullmatch(r"[+-][xyz]", sc["face"]):
            o["face"] = sc["face"]
        out["screen"] = o
    sp = fx.get("spin")
    if sp is True:
        out["spin"] = {}
    elif isinstance(sp, dict):
        o = {}
        a = vec(sp.get("axis"))
        if a and any(a):
            o["axis"] = a
        c = vec(sp.get("center"))
        if c:
            o["center"] = c
        try:
            if sp.get("rpm") is not None and float(sp["rpm"]) > 0:
                o["rpm"] = float(sp["rpm"])
        except (TypeError, ValueError):
            pass
        out["spin"] = o
    unknown = [k for k in fx if k not in ("glow", "screen", "spin")]
    if unknown:
        print(f"  fx: part '{name}': unknown keys {unknown} ignored (glow / screen / spin)")
    return out


SCENES = ("desk", "wall", "counter", "shelf", "handlebar", "floor")
FACES = ("-z", "+z", "-y", "+y", "-x", "+x")


def scene_meta(mod, raw_steps, rows, manifest):
    """SCENE / SCENE_FACE / ASSEMBLY module constants (and per-part "step") -> manifest scene / assembly_order.
    Never fails the build: bad values only warn."""
    sc = getattr(mod, "SCENE", None)
    if isinstance(sc, str) and sc.strip().lower() in SCENES:
        manifest["scene"] = sc.strip().lower()
        face = getattr(mod, "SCENE_FACE", None)
        if isinstance(face, str) and face.strip().lower() in FACES:
            manifest["scene_face"] = face.strip().lower()
        elif face is not None:
            print(f"  WARNING: SCENE_FACE must be one of {', '.join(FACES)}, got {face!r}")
    elif sc is not None:
        print(f"  WARNING: SCENE must be one of {', '.join(SCENES)}, got {sc!r}")
    names = [r["name"] for r in rows]
    by_raw = {}
    for r in rows:
        by_raw.setdefault(r["raw_name"], []).append(r["name"])

    def resolve(n):
        n = str(n)
        if n in by_raw:
            return by_raw[n]
        return [n] if n in names else []
    steps = []
    asm = getattr(mod, "ASSEMBLY", None)
    if isinstance(asm, (list, tuple)) and asm:
        for st in asm:
            group = st if isinstance(st, (list, tuple)) else [st]
            got = []
            for n in group:
                hit = resolve(n)
                if not hit:
                    print(f"  WARNING: ASSEMBLY names an unknown part {n!r}")
                got += [h for h in hit if h not in got]
            if got:
                steps.append(got)
    elif raw_steps:
        for k in sorted({s for s, _ in raw_steps}):
            steps.append([n for s, n in raw_steps if s == k])
    if steps:
        manifest["assembly_order"] = steps
        print(f"assembly: {len(steps)} steps")


def clean_section(v):
    """A part's optional section ("Y axis"): one line, at most 40 chars, first letter upper case; None if empty."""
    if not isinstance(v, str):
        return None
    v = re.sub(r"\s+", " ", v).strip()[:40].strip()
    return (v[0].upper() + v[1:]) if v else None


def manifest_part(r):
    m = {"file": f"stl/{r['slug']}.stl", "name": r["name"], "group": r["group"], "process": r["process"],
         "color": r["color"], "explode": r["explode"], "bbox": r["bbox"]}
    if r.get("design_color"):
        m["design_color"] = r["design_color"]
    for k in ("material", "engrave", "cable", "port", "step", "section"):  # step: rmfg STEP file for a metal part
        if r.get(k) is not None:
            m[k] = r[k]
    if r.get("subparts"):
        m["subparts"] = r["subparts"]
    if r.get("fx") is not None:
        m["fx"] = r["fx"]
    if r.get("ref_model"):  # cadlib.refmodels.ref(): the viewer draws the vetted model here (display only)
        rm = r["ref_model"]
        m["ref_model"] = {"key": str(rm.get("key")), "m": rm.get("m"), "yours": bool(rm.get("yours"))}
    lib = r.get("lib")
    if lib:
        line = lib.get("bom") or {}
        m["lib"] = {"key": lib.get("key"), "qty": int(lib.get("qty") or 1), "name": line.get("name"),
                    "unit_cost_usd": line.get("unit_cost_usd"), "mass_g": lib.get("mass_g")}
    return m


def _thin_axis(r):
    bb = r["bbox"]
    return min(range(3), key=lambda i: bb[i])


def _num(v, default):
    try:
        v = float(v)
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


def _outline_perimeter(s, axis):
    """Sum of edge lengths of the biggest planar face facing +axis, per solid (outer outline + holes)."""
    total, n = 0.0, 0
    for sol in (s.Solids() or [s]):
        best = None
        for f in sol.Faces():
            if f.geomType() != "PLANE":
                continue
            nv = f.normalAt()
            comp = (nv.x, nv.y, nv.z)[axis]
            if comp > 0.99 and (best is None or f.Area() > best.Area()):
                best = f
        if best is None:
            return None
        total += sum(e.Length() for e in best.Edges())
        n += 1
    return total if n else None


def fab_estimate(r):
    """Shop-time + stock estimate for one extrusion / sheet / laser part. Returns (est, params)."""
    proc, params, bb = r["process"], dict(r["params"]), r["bbox"]
    s = r.get("cq")
    if proc == "extrusion":
        prof = str(params.get("profile") or "2020")
        length = _num(params.get("length_mm"), max(bb))
        taps = int(_num(params.get("tapped_ends"), 2))
        params.update(profile=prof, length_mm=round(length, 1))
        usd = EXTRUSION_USD_PER_M.get(re.sub(r"[^0-9]", "", prof)[:4], 8.0) * length / 1000.0
        if length > EXTRUSION_MAX:
            print(f"  WARNING: extrusion '{r['name']}' is {length:.0f} mm, longer than {EXTRUSION_MAX:.0f} mm stock")
        return {"length_mm": round(length, 1), "minutes": round(2.0 + 1.5 * taps, 1),
                "material_usd": round(usd, 2)}, params
    if proc == "sheet":
        t = _num(params.get("thickness_mm"), 0)
        if not t:
            area_s = 0.0
            try:
                area_s = s.Area() if s is not None else 0.0
            except Exception:
                pass
            t = round(2 * r["vol"] / area_s, 2) if area_s > 0 and r["vol"] > 0 else min(bb)
        mat = str(params.get("material") or "aluminium 5052")
        bends = int(_num(params.get("bends"), 0))
        # flat-pattern area ~ volume / thickness (counts flanges); fall back to the biggest bbox face
        flat_mm2 = r["vol"] / t if r["vol"] > 0 else sorted(bb)[1] * sorted(bb)[2]
        area_cm2 = flat_mm2 / 100.0
        key = next((k for k in SHEET_USD_PER_CM2_MM if k in mat.lower()), "steel")
        params.update(material=mat, thickness_mm=t, bends=bends)
        if area_cm2 * 100 > SHEET_MAX[0] * SHEET_MAX[1]:
            print(f"  WARNING: sheet part '{r['name']}' flat area {area_cm2:.0f} cm2 exceeds a {SHEET_MAX[0]:.0f} x {SHEET_MAX[1]:.0f} mm blank")
        return {"area_cm2": round(area_cm2, 1), "bends": bends, "minutes": round(4.0 + area_cm2 / 100.0 + 1.5 * bends, 1),
                "material_usd": round(area_cm2 * t * SHEET_USD_PER_CM2_MM[key], 2)}, params
    # laser
    axis = _thin_axis(r)
    t = _num(params.get("thickness_mm"), round(bb[axis], 1))
    mat = str(params.get("material") or "acrylic")
    plan = [bb[i] for i in range(3) if i != axis]
    cut = None
    if s is not None:
        try:
            cut = _outline_perimeter(s, axis)
        except Exception:
            cut = None
    if not cut:
        cut = 2 * (plan[0] + plan[1])
    area_cm2 = (r["vol"] / t if r["vol"] > 0 else plan[0] * plan[1]) / 100.0
    speed = 20.0 if t <= 3.5 else 8.0  # mm/s, CO2 laser in acrylic/ply
    key = next((k for k in LASER_USD_PER_CM2_MM if k in mat.lower()), "acrylic")
    params.update(material=mat, thickness_mm=t)
    if max(plan) > LASER_BED[0] or min(plan) > LASER_BED[1]:
        print(f"  WARNING: laser part '{r['name']}' ({plan[0]:.0f} x {plan[1]:.0f} mm) exceeds the {LASER_BED[0]:.0f} x {LASER_BED[1]:.0f} mm bed")
    return {"cut_length_mm": round(cut, 1), "area_cm2": round(area_cm2, 1),
            "minutes": round(1.0 + cut / speed / 60.0, 1),
            "material_usd": round(area_cm2 * t * LASER_USD_PER_CM2_MM[key], 2)}, params


def render_thumb_subprocess(design_dir, timeout=60, view="iso"):
    """Render thumb.png in a child process so a VTK problem can never fail the build."""
    t = time.time()
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = dict(os.environ)
    env["PYTHONPATH"] = app_dir + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    try:
        r = subprocess.run([sys.executable, "-m", "cadlib.render_thumb", design_dir, "--view", view], env=env,
                           capture_output=True, text=True, timeout=timeout)
        if r.returncode == 0:
            print(f"thumb.png rendered ({time.time() - t:.1f}s)")
        else:
            print("  warning: thumbnail render failed (model is fine):\n" + (r.stderr or r.stdout)[-1500:])
    except subprocess.TimeoutExpired:
        print("  warning: thumbnail render timed out (model is fine)")
    except Exception as e:
        print(f"  warning: thumbnail render error (model is fine): {e}")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    thumb = "--no-thumb" not in argv
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print("usage: python -m cadlib.build <design_dir> [--no-thumb]", file=sys.stderr)
        return 2
    design_dir = os.path.abspath(args[0])
    if not os.path.isdir(design_dir):
        print(f"error: {design_dir} is not a directory", file=sys.stderr)
        return 2
    log = io.StringIO()
    out, err = sys.stdout, sys.stderr
    sys.stdout = Tee(out, log)
    sys.stderr = Tee(err, log)
    code = 0
    try:
        build(design_dir, thumb=thumb)
    except BuildError as e:
        print(f"\nBUILD FAILED: {e}", file=sys.stderr)
        code = 1
    except SyntaxError as e:
        print(f"\nBUILD FAILED: syntax error in {os.path.basename(e.filename or 'design.py')} "
              f"line {e.lineno}: {e.msg}\n  {(e.text or '').rstrip()}", file=sys.stderr)
        code = 1
    except BaseException as e:  # noqa
        tb = traceback.format_exc()
        where = ""
        for fr in traceback.extract_tb(e.__traceback__):
            if os.path.basename(fr.filename) == "design.py":
                where = f"\n  at design.py line {fr.lineno} in {fr.name}(): {fr.line}"
        print(f"\nBUILD FAILED: {type(e).__name__}: {e}{where}\n\n{tb}", file=sys.stderr)
        code = 1
    finally:
        sys.stdout, sys.stderr = out, err
        try:
            with open(os.path.join(design_dir, "build_log.txt"), "w") as f:
                f.write(log.getvalue())
        except Exception:
            pass
    return code


if __name__ == "__main__":
    sys.exit(main())
