"""Reference model converter: CadQuery Model / STEP / STL / OBJ / 3MF -> a small GLB for the viewer.

    python -m cadlib.refmodels convert <file> <key> --license <license.json> [--units mm|cm|m|in] [--rotate rx,ry,rz]
                                       [--max-tris 40000] [--color "#888888"]

Output frame (the library's convention, see LICENSES.md): millimetres, Z up, origin at the bounding-box centre.
Standing products face -Y; boards lie flat with components up (+Z). One mesh per (finish, colour) group, each with a
PBR material named "<finish>[:<role>]" (finishes as in web/finish.js: pcb, metal, gold, plastic, rubber, glass).
Vertices are shared only inside one CAD face, so the viewer's smooth normals keep hard edges between faces.

Downloaded files are untrusted data: they are only parsed (OCCT STEP reader / trimesh), never executed. Run this with
`python -I` when the input came from the web.
"""
import json
import math
import os

import numpy as np

FINISH_PBR = {  # finish -> (metallic, roughness); same table as web/finish.js
    "pcb": (0.0, 0.42), "metal": (0.92, 0.34), "gold": (1.0, 0.24), "plastic": (0.0, 0.58),
    "rubber": (0.0, 0.92), "glass": (0.0, 0.07),
}
UNITS = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4}
MAX_BYTES = 1_100_000


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]


def _tess(shape, tol, ang):
    """(vertices Nx3, faces Mx3) of a cq.Shape, vertices shared only within each B-rep face."""
    vs, fs, off = [], [], 0
    for face in shape.Faces():
        try:
            v, t = face.tessellate(tol, ang)
        except Exception:
            continue
        if not t:
            continue
        vs.append(np.array([x.toTuple() for x in v], dtype=np.float64))
        fs.append(np.array(t, dtype=np.int64) + off)
        off += len(v)
    if not vs:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.vstack(vs), np.vstack(fs)


def model_parts(model, tol=None, ang=0.3):
    """cadlib Model -> [{"finish", "role", "color", "v", "f"}]."""
    import cadquery as cq
    comps = model.compounds()
    allc = cq.Compound.makeCompound([c for _, _, c in comps])
    bb = allc.BoundingBox()
    size = max(bb.xlen, bb.ylen, bb.zlen)
    tol = tol or min(0.12, max(0.012, size / 900.0))
    out = []
    for fin, color, comp in comps:
        finish, _, role = str(fin).partition(":")
        v, f = _tess(comp, tol, ang)
        if len(f):
            out.append({"finish": finish if finish in FINISH_PBR else "plastic", "role": role, "color": color.lower(), "v": v, "f": f})
    return out


def step_parts(path, tol=None, ang=None, default_color="#8a8f98"):
    """STEP with XCAF colours (KiCad / manufacturer models carry per-solid colours) -> parts, grouped by colour."""
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType, XCAFDoc_ColorTool
    from OCP.TDF import TDF_LabelSequence
    from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
    from OCP.TopLoc import TopLoc_Location
    from OCP.IFSelect import IFSelect_RetDone
    import cadquery as cq

    doc = TDocStd_Document(TCollection_ExtendedString("doc"))
    rd = STEPCAFControl_Reader()
    rd.SetColorMode(True)
    rd.SetNameMode(True)
    if rd.ReadFile(str(path)) != IFSelect_RetDone:
        raise RuntimeError(f"could not read STEP {path}")
    rd.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

    def color_of(label, shape):
        c = Quantity_Color()
        for typ in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen):
            if XCAFDoc_ColorTool.GetColor_s(label, typ, c) or ct.GetColor(shape, typ, c):
                r, g, b = c.Red(), c.Green(), c.Blue()  # linear RGB in OCCT
                to = lambda x: max(0, min(255, round((x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055) * 255)))
                return "#%02x%02x%02x" % (to(r), to(g), to(b))
        return None

    groups = {}

    def walk(label, loc, inherited):
        shape = st.GetShape_s(label)
        col = color_of(label, shape) or inherited
        if st.IsAssembly_s(label) or st.IsReference_s(label):
            if st.IsReference_s(label):
                ref = label.__class__()
                st.GetReferredShape_s(label, ref)
                walk(ref, loc.Multiplied(st.GetLocation_s(label)), col)
                return
            seq = TDF_LabelSequence()
            st.GetComponents_s(label, seq)
            for i in range(1, seq.Length() + 1):
                walk(seq.Value(i), loc, col)
            return
        # simple shape: sub-shapes may carry their own colours (KiCad colours faces / solids)
        subs = TDF_LabelSequence()
        st.GetSubShapes_s(label, subs)
        sub_col = []  # [(faces of a coloured sub-shape, colour)]
        for i in range(1, subs.Length() + 1):
            sl = subs.Value(i)
            ss = st.GetShape_s(sl)
            c = color_of(sl, ss)
            if c:
                sub_col.append(([f.wrapped for f in cq.Shape.cast(ss).Faces()], c))
        if sub_col:
            for face in cq.Shape.cast(shape).Faces():
                fc = None
                for faces, c in sub_col:
                    if any(face.wrapped.IsPartner(f) for f in faces):
                        fc = c
                        break
                groups.setdefault(fc or col or default_color, []).append(cq.Shape.cast(face.wrapped.Moved(loc)))
        else:
            groups.setdefault(col or default_color, []).append(cq.Shape.cast(shape.Moved(loc)))

    roots = TDF_LabelSequence()
    st.GetFreeShapes(roots)
    for i in range(1, roots.Length() + 1):
        walk(roots.Value(i), TopLoc_Location(), None)
    comp_all = cq.Compound.makeCompound([x for xs in groups.values() for x in xs])
    bb = comp_all.BoundingBox()
    ang = ang or (0.5 if tol else 0.3)  # a coarse tol also relaxes the angle (small pins and holes dominate)
    tol = tol or min(0.08, max(0.01, max(bb.xlen, bb.ylen, bb.zlen) / 900.0))
    out = []
    for color, shapes in groups.items():
        v, f = _tess(cq.Compound.makeCompound(shapes), tol, ang)
        if len(f):
            out.append({"finish": guess_finish(color), "role": "", "color": color, "v": v, "f": f})
    return out


def guess_finish(hex_color):
    r, g, b = hex_rgb(hex_color)
    mx, mn = max(r, g, b), min(r, g, b)
    if r > 0.7 and 0.5 < g < 0.85 and b < 0.45:
        return "gold"
    if mx - mn < 0.08 and 0.55 < mx < 0.9:
        return "metal"
    return "plastic"


def mesh_parts(path, color="#8a8f98"):
    """STL / OBJ / 3MF / GLB -> parts (one per material colour when the file has them). Creases split at 35 degrees."""
    import trimesh
    sc = trimesh.load(path, force="scene")
    out = []
    for name, geom in sc.geometry.items():
        if not isinstance(geom, trimesh.Trimesh) or not len(geom.faces):
            continue
        g = geom.copy()
        for node in sc.graph.geometry_nodes.get(name, []):
            mat, _ = sc.graph[node]
            g = geom.copy()
            g.apply_transform(mat)
            out.append(_split_creases(g, _mesh_color(geom, color)))
        if not sc.graph.geometry_nodes.get(name):
            out.append(_split_creases(g, _mesh_color(geom, color)))
    return out


def _mesh_color(m, default):
    try:
        mat = m.visual.material
        c = getattr(mat, "baseColorFactor", None)
        if c is None:
            c = getattr(mat, "diffuse", None)
        if c is not None:
            c = np.asarray(c, dtype=float)[:3]
            if c.max() > 1.0:
                c = c / 255.0
            return "#%02x%02x%02x" % tuple(int(round(x * 255)) for x in c)
    except Exception:
        pass
    try:
        fc = np.asarray(m.visual.face_colors)[:, :3].mean(axis=0)
        return "#%02x%02x%02x" % tuple(int(x) for x in fc)
    except Exception:
        return default


def _split_creases(m, color, angle=math.radians(35)):
    import trimesh
    m = trimesh.Trimesh(m.vertices, m.faces, process=True)
    try:
        s = trimesh.graph.smooth_shade(m, angle=angle)
        v, f = s.vertices, s.faces
    except Exception:
        v, f = m.vertices[m.faces].reshape(-1, 3), np.arange(len(m.faces) * 3).reshape(-1, 3)
    return {"finish": guess_finish(color), "role": "", "color": color, "v": np.asarray(v, float), "f": np.asarray(f, np.int64)}


def transform(parts, units="mm", rotate=(0, 0, 0)):
    """Scale to mm, rotate (degrees about X, then Y, then Z), centre the bounding box on the origin."""
    from trimesh import transformations as tf
    k = UNITS[units]
    R = tf.euler_matrix(*[math.radians(a) for a in rotate], "sxyz")[:3, :3]
    for p in parts:
        p["v"] = (p["v"] * k) @ R.T
    lo = np.min([p["v"].min(axis=0) for p in parts], axis=0)
    hi = np.max([p["v"].max(axis=0) for p in parts], axis=0)
    c = (lo + hi) / 2
    for p in parts:
        p["v"] = p["v"] - c
    return parts, (hi - lo)


def decimate(parts, max_tris):
    """Quadric decimation of the biggest groups until the total is under max_tris (needs fast_simplification;
    without it the mesh is kept as is and a warning is printed)."""
    total = sum(len(p["f"]) for p in parts)
    if total <= max_tris:
        return parts
    try:
        import fast_simplification
    except ImportError:
        print(f"  warning: {total} triangles > {max_tris} and fast_simplification is not installed; not decimated")
        return parts
    ratio = 1.0 - max_tris / total
    for p in parts:
        if len(p["f"]) < 200:
            continue
        v, f = fast_simplification.simplify(p["v"].astype(np.float32), p["f"].astype(np.int32), target_reduction=ratio)
        p["v"], p["f"] = np.asarray(v, float), np.asarray(f, np.int64)
    return parts


def merge_groups(parts):
    """One part per (finish, role, colour)."""
    out = {}
    for p in parts:
        k = (p["finish"], p["role"], p["color"])
        if k not in out:
            out[k] = {"finish": p["finish"], "role": p["role"], "color": p["color"], "v": [], "f": [], "n": 0}
        o = out[k]
        o["v"].append(p["v"])
        o["f"].append(p["f"] + o["n"])
        o["n"] += len(p["v"])
    return [{"finish": o["finish"], "role": o["role"], "color": o["color"], "v": np.vstack(o["v"]), "f": np.vstack(o["f"])}
            for o in out.values()]


def write_glb(parts, out_path):
    """Write parts as a GLB (positions float32 + uint32 indices, one PBR material per group)."""
    import trimesh
    from trimesh.visual.material import PBRMaterial
    from trimesh.visual import TextureVisuals
    sc = trimesh.Scene()
    for i, p in enumerate(parts):
        met, rough = FINISH_PBR.get(p["finish"], FINISH_PBR["plastic"])
        rgb = [srgb_to_linear(c) for c in hex_rgb(p["color"])]
        name = p["finish"] + (":" + p["role"] if p["role"] else "")
        mat = PBRMaterial(name=name, baseColorFactor=[*rgb, 1.0], metallicFactor=met, roughnessFactor=rough, doubleSided=True)
        m = trimesh.Trimesh(p["v"].astype(np.float32), p["f"], process=False)
        m.visual = TextureVisuals(material=mat)
        sc.add_geometry(m, geom_name=f"g{i}-{name.replace(':', '-')}")
    data = sc.export(file_type="glb", include_normals=False)
    tmp = out_path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, out_path)
    return len(data)


def finish_parts(parts, units="mm", rotate=(0, 0, 0), max_tris=40000):
    parts = merge_groups(parts)
    parts, size = transform(parts, units, rotate)
    parts = decimate(parts, max_tris)
    return parts, [round(float(x), 2) for x in size]


def convert_file(src, out_dir, units="mm", rotate=(0, 0, 0), max_tris=40000, color="#8a8f98", tol=None):
    """Any supported file -> out_dir/model.glb. Returns (size_mm [x, y, z], bytes, triangles)."""
    ext = os.path.splitext(src)[1].lower()
    if ext in (".step", ".stp"):
        parts = step_parts(src, tol=tol, default_color=color)
    elif ext in (".stl", ".obj", ".3mf", ".glb", ".gltf", ".ply", ".off"):
        parts = mesh_parts(src, color)
    else:
        raise ValueError(f"unsupported format {ext} (STEP, STL, OBJ, 3MF, GLB)")
    if not parts:
        raise RuntimeError(f"{src}: no geometry")
    parts, size = finish_parts(parts, units, rotate, max_tris)
    os.makedirs(out_dir, exist_ok=True)
    n = write_glb(parts, os.path.join(out_dir, "model.glb"))
    return size, n, sum(len(p["f"]) for p in parts)


def convert_model(model, out_dir, max_tris=60000, tol=None):
    parts = model_parts(model, tol=tol)
    parts, size = finish_parts(parts, "mm", (0, 0, 0), max_tris)
    os.makedirs(out_dir, exist_ok=True)
    n = write_glb(parts, os.path.join(out_dir, "model.glb"))
    return size, n, sum(len(p["f"]) for p in parts)


def glb_info(path):
    """(size_mm, triangles, materials) of a GLB (for tests / the index)."""
    import trimesh
    sc = trimesh.load(path, force="scene")
    lo, hi = sc.bounds
    tris = sum(len(g.faces) for g in sc.geometry.values())
    mats = sorted({getattr(g.visual.material, "name", "") for g in sc.geometry.values()})
    return [round(float(x), 2) for x in (hi - lo)], tris, mats


def load_json(p):
    with open(p) as f:
        return json.load(f)
