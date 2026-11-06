"""Looks: per-part material presets, engraved / embossed text, decorative cables (manifest fields read by web/materials.js).

    from cadlib.look import engrave_text
    panel, eng = engrave_text(panel, "JOSH", face="<Y", depth=1.0)          # cut 1 mm into the front face
    {"name": "Name panel", "shape": panel, "process": "laser", "material": "acrylic_clear", "engrave": eng,
     "cable": {"type": "usb-c", "at": [-110, 5, 10], "dir": [-1, 0, 0], "length_mm": 500}}

material: one of MATERIALS (pla / petg = the printed look). engrave: the dict engrave_text() returns (the viewer finds
the cut faces and shows them frosted / lit on acrylic, burnt on wood, inked on prints). cable: decoration only (never a
part, never priced): a plug in the port at `at` (mm, outer surface), pointing out along `dir`, running to the floor.
A module-level CABLES = [...] in design.py declares design-level cables; CABLES = False turns the automatic one off.
"""
import math

MATERIALS = ("acrylic_clear", "acrylic_frosted", "glass", "aluminium", "steel", "brass", "rubber", "silicone",
             "pcb", "wood", "plywood", "pla", "petg")
ALIASES = {"acrylic": "acrylic_clear", "clear_acrylic": "acrylic_clear", "frosted_acrylic": "acrylic_frosted",
           "perspex": "acrylic_clear", "aluminum": "aluminium", "alu": "aluminium", "stainless": "steel",
           "stainless_steel": "steel", "ply": "plywood", "mdf": "wood", "timber": "wood"}
CABLE_TYPES = ("usb-c", "dc-barrel", "jst")
ENGRAVE_MODES = ("engrave", "emboss", "cut")
ENGRAVE_STYLES = ("auto", "frosted", "lit", "burnt", "ink", "etched")


def norm_material(v):
    """Preset id for a material string, or None (unknown values are dropped, never fail the build)."""
    if not isinstance(v, str) or not v.strip():
        return None
    k = v.strip().lower().replace("-", "_").replace(" ", "_")
    k = ALIASES.get(k, k)
    return k if k in MATERIALS else None


def infer_material(process, params):
    """Material from fabrication params (laser {material}, sheet {material}, extrusion): None when unsure."""
    m = str((params or {}).get("material") or "").lower()
    if process == "extrusion":
        return "aluminium"
    if process == "laser":
        if "frost" in m or "opal" in m:
            return "acrylic_frosted"
        if "acrylic" in m or "perspex" in m or "pmma" in m:
            return "acrylic_clear"
        if "ply" in m or "birch" in m:
            return "plywood"
        if "wood" in m or "mdf" in m or "bamboo" in m or "oak" in m or "walnut" in m:
            return "wood"
        if "glass" in m:
            return "glass"
    if process == "sheet":
        if "brass" in m:
            return "brass"
        if "steel" in m or "stainless" in m:
            return "steel"
        return "aluminium"
    return None


def _vec3(v):
    try:
        out = [float(x) for x in v]
    except (TypeError, ValueError):
        return None
    if len(out) != 3 or not all(math.isfinite(x) for x in out):
        return None
    return out


def norm_cable(c):
    """Clean a cable dict (None when unusable)."""
    if not isinstance(c, dict):
        return None
    at = _vec3(c.get("at"))
    if at is None:
        return None
    d = _vec3(c.get("dir") if c.get("dir") is not None else [1, 0, 0])
    n = math.sqrt(sum(x * x for x in d)) if d else 0
    if not n:
        return None
    t = str(c.get("type") or "usb-c").lower().replace("_", "-")
    t = {"usbc": "usb-c", "usb": "usb-c", "dc": "dc-barrel", "barrel": "dc-barrel", "dc-jack": "dc-barrel"}.get(t, t)
    out = {"type": t if t in CABLE_TYPES else "usb-c", "at": [round(x, 2) for x in at],
           "dir": [round(x / n, 4) for x in d]}
    try:
        out["length_mm"] = max(80.0, min(2000.0, float(c.get("length_mm") or 450)))
    except (TypeError, ValueError):
        out["length_mm"] = 450.0
    col = c.get("color")
    if isinstance(col, str) and len(col) == 7 and col.startswith("#"):
        out["color"] = col.lower()
    return out


def norm_engrave(e):
    """Clean an engrave dict (True -> {}); None when absent."""
    if e is True:
        return {"mode": "engrave"}
    if not isinstance(e, dict):
        return None
    out = {}
    if isinstance(e.get("text"), str):
        out["text"] = e["text"][:120]
    f = e.get("face")
    if isinstance(f, str) and len(f) == 2 and f[0] in "<>" and f[1].upper() in "XYZ":
        out["face"] = f[0] + f[1].upper()
    try:
        out["depth_mm"] = round(max(0.1, float(e.get("depth_mm", e.get("depth", 1.0)))), 2)
    except (TypeError, ValueError):
        out["depth_mm"] = 1.0
    m = e.get("mode")
    out["mode"] = m if m in ENGRAVE_MODES else "engrave"
    s = e.get("style")
    if s in ENGRAVE_STYLES:
        out["style"] = s
    col = e.get("color")
    if isinstance(col, str) and len(col) == 7 and col.startswith("#"):
        out["color"] = col.lower()
    if isinstance(e.get("size_mm"), (int, float)):
        out["size_mm"] = round(float(e["size_mm"]), 2)
    return out


# ------------------------------------------------------------------------------------------------- engraved text
_FACES = {">X": (1, 0, 0), "<X": (-1, 0, 0), ">Y": (0, 1, 0), "<Y": (0, -1, 0), ">Z": (0, 0, 1), "<Z": (0, 0, -1)}


def _face_plane(shape, face, mirror=False):
    """cq.Plane on the outer `face` of shape's bounding box, text upright (local y = +Z on side faces) and reading
    correctly from outside that face (mirror=True: reads correctly through a clear panel from the opposite side)."""
    import cadquery as cq
    n = cq.Vector(*_FACES[face])
    bb = shape.BoundingBox()
    c = [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2]
    lim = {"X": (bb.xmin, bb.xmax), "Y": (bb.ymin, bb.ymax), "Z": (bb.zmin, bb.zmax)}[face[1]]
    i = "XYZ".index(face[1])
    c[i] = lim[1] if face[0] == ">" else lim[0]
    if abs(n.z) > 0.5:
        x = cq.Vector(1, 0, 0) if n.z > 0 else cq.Vector(-1, 0, 0)
    else:
        x = cq.Vector(0, 0, 1).cross(n)  # horizontal, so local y = n x x = +Z (upright)
    if mirror:
        x = x * -1
    return cq.Plane(origin=cq.Vector(*c), xDir=x, normal=n), bb


def _plane_extent(bb, plane):
    """Width / height of shape's bbox as seen on the plane."""
    ext = (bb.xlen, bb.ylen, bb.zlen)
    w = sum(abs(plane.xDir.toTuple()[k]) * ext[k] for k in range(3))
    h = sum(abs(plane.yDir.toTuple()[k]) * ext[k] for k in range(3))
    return w, h


def engrave_text(body, text, face=">Z", depth=1.0, size=None, mode="engrave", offset=(0.0, 0.0), fit=0.8,
                 kind="bold", font="Arial", mirror=False, style=None):
    """Cut (mode "engrave"), raise ("emboss") or cut through ("cut") `text` on the flat outer `face` of `body`
    ('>X' '<X' '>Y' '<Y' '>Z' '<Z'). size: cap height in mm, None = fit `fit` of the face width / 50% of its height.
    offset: (right, up) mm on the face from its centre. Returns (new_body, engrave_dict) - put engrave_dict on the part
    as "engrave" so the viewer shows the lettering. Raises ValueError if the text does not change the body."""
    import cadquery as cq
    if face not in _FACES:
        raise ValueError(f"face must be one of {', '.join(_FACES)}")
    if mode not in ENGRAVE_MODES:
        raise ValueError(f"mode must be one of {', '.join(ENGRAVE_MODES)}")
    text = str(text)
    if not text.strip():
        raise ValueError("engrave_text: empty text")
    wp = body if isinstance(body, cq.Workplane) else cq.Workplane("XY").add(body)
    shape = wp.val() if len(wp.vals()) == 1 else cq.Compound.makeCompound([v for v in wp.vals() if isinstance(v, cq.Shape)])
    plane, bb = _face_plane(shape, face, mirror)
    fw, fh = _plane_extent(bb, plane)
    thick = sum(abs(plane.zDir.toTuple()[k]) * (bb.xlen, bb.ylen, bb.zlen)[k] for k in range(3))
    depth = float(depth)
    if mode == "cut":
        depth = thick + 0.2

    def solid(sz, d, lift):
        p = cq.Plane(origin=plane.origin + plane.zDir * lift + plane.xDir * offset[0] + plane.yDir * offset[1],
                     xDir=plane.xDir, normal=plane.zDir)
        return cq.Workplane(p).text(text, sz, d, kind=kind, font=font, halign="center", valign="center", combine=False)

    if size is None:
        size = max(2.0, fh * 0.5)
        probe = solid(size, 1.0, 0.0).val().BoundingBox()
        tw, th = _plane_extent(probe, plane)
        k = min(fw * fit / max(tw, 1e-6), fh * fit / max(th, 1e-6), 1.0)
        size = max(1.5, size * k)
    if mode == "emboss":
        txt = solid(size, depth + 0.05, -0.05)
        out = wp.union(txt)
    else:  # engrave / cut: from just above the face down into the body
        txt = solid(size, depth + 0.05, -depth)
        out = wp.cut(txt)
    v0 = sum(abs(s.Volume()) for s in wp.solids().vals())
    v1 = sum(abs(s.Volume()) for s in out.solids().vals())
    if abs(v1 - v0) < 0.05:
        raise ValueError(f"engrave_text: '{text}' did not touch face {face} (check face / offset / size)")
    meta = {"text": text, "face": face, "depth_mm": round(depth, 2), "mode": mode, "size_mm": round(size, 2)}
    if style:
        meta["style"] = style
    return out, meta
