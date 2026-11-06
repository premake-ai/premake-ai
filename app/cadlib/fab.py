"""Helpers for non-printed processes and common bought parts.  `from cadlib import fab`

All return cq.Workplane in mm, Z up. Fabricated helpers return the solid only; you set
"process"/"params" on the part dict yourself (see design_agent_prompt.md).

  fab.extrusion(length, profile="2020", axis="x", at=(0,0,0))   aluminium V/T-slot bar; `at` = centre of the start end
  fab.sheet_bent(points, width, t=1.5)   folded sheet: `points` = (x, z) centreline of the bend profile in XZ,
                                         extruded `width` along +Y from y=0 (L, U, Z, hat sections ...)
  fab.panel(w, h, t=3, r=0, holes=())    flat laser-cut plate in XY (centred, z 0..t); holes = [(x, y, dia)]
  fab.sheet_actual("plywood", 6)         real thickness of nominal stock (5.5 mm for "6 mm" ply), from cadlib.dims
  fab.slot_width("plywood", 6, fit="press")   slot for that real sheet: press = actual - 0.1, slip = actual + 0.15
  fab.pilot(d=3)                         printed pilot hole for a self-tapping screw: M2 1.6, M2.5 2.0, M3 2.5, M3.5 2.9, M4 3.3
  fab.screw_boss(d=3, h=10, depth=None, od=None, at=(0,0,0))   (boss, hole): a round boss (OD 2.5 x d) standing on z=0
                                         at `at`, and the pilot-hole cutter going down from its top. body.union(boss).cut(hole)
  fab.nema17(length=40)                  motor dummy, face plate on z=0, body below, shaft up (+Z)
  fab.esp32_devkit(kind="s3")            "s3" (ESP32-S3-DevKitC-1), "c3mini" (ESP32-C3 SuperMini), "wroom" (30-pin DevKit V1)
  fab.buck(kind="lm2596")                "lm2596" or "mp1584" converter module
  fab.led_strip(length, width=10)        WS2812B / COB strip on its tape, lying in XY along +X from x=0
  fab.stepstick()                        TMC2209 / A4988 driver module with heatsink

The component dummies are kept for old designs. On build, a dummy that was only moved / rotated is shown with the
detailed model from cadlib.parts (same origin and orientation); new designs use cadlib.parts.part(...) directly.
"""
import cadquery as cq

PROFILES = {  # w, h, slot opening, slot depth, centre bore
    "2020": (20.0, 20.0, 6.2, 6.0, 4.2),
    "2040": (20.0, 40.0, 6.2, 6.0, 4.2),
    "3030": (30.0, 30.0, 8.2, 9.0, 6.8),
}


SHEET_CLASSES = (("plywood", ("ply", "birch", "wood")), ("acrylic", ("acrylic", "pmma", "perspex", "plexi")), ("mdf", ("mdf", "hardboard")))
SLOT_FIT = {"press": -0.1, "slip": 0.15}


def sheet_actual(material="plywood", nominal=3.0):
    """Actual thickness (mm) of nominal laser stock, e.g. sheet_actual("plywood", 6) -> 5.5. Model the sheet and its
    mating slots with this; keep the nominal in "params": {"thickness_mm": 6} (that is what we buy and price)."""
    from cadlib import dims
    m = str(material).lower()
    cls = next((c for c, words in SHEET_CLASSES if any(w in m for w in words)), None)
    stock = dims.dim("laser_sheet_stock")
    v = stock.get(f"{cls}_{float(nominal):g}_actual_mm") if cls else None
    if v is None:
        raise ValueError(f"no actual thickness for {material!r} {nominal:g} mm (stock: 3 or 6 mm plywood, acrylic, mdf)")
    return float(v)


def slot_width(material="plywood", nominal=3.0, fit="press"):
    """Slot / tab-socket width for that real sheet: "press" (kerf-tight, actual - 0.1) or "slip" (actual + 0.15)."""
    return round(sheet_actual(material, nominal) + SLOT_FIT[fit], 2)


def pilot(d=3.0):
    """Pilot hole diameter (mm) printed for a self-tapping screw of size d (M2..M4) in PLA / PETG / ASA."""
    from cadlib.parts.catalog import PILOT
    d = float(d)
    if d not in PILOT:
        raise ValueError(f"no pilot size for M{d:g} self-tapping screws (have M2, M2.5, M3, M3.5, M4)")
    return PILOT[d]


def screw_boss(d=3.0, h=10.0, depth=None, od=None, at=(0.0, 0.0, 0.0)):
    """A screw boss for a self-tapping screw: returns (boss, hole). boss is a cylinder of outer diameter `od`
    (default 2.5 x d, never under 2 x d + 1) and height h standing on at=(x, y, z); hole is the pilot-hole cutter from the
    boss top down `depth` mm (default: h - 1.2, a closed floor). Union the boss into the body, then cut the hole."""
    d = float(d)
    od = max(float(od or 2.5 * d), 2 * d + 1.0)
    depth = float(depth) if depth else max(2 * d, h - 1.2)
    x, y, z = at
    boss = cq.Workplane("XY").circle(od / 2).extrude(h).translate((x, y, z))
    hole = cq.Workplane("XY").circle(pilot(d) / 2).extrude(depth).translate((x, y, z + h - depth))
    return boss, hole


def _lib(w, key, **params):
    """Tag a dummy with the library part it stands for (see cadlib.parts.tagged_subparts)."""
    try:
        from cadlib import parts
        return parts.tag(w, key, params)
    except Exception:
        return w


def _box(x, y, z, cx=0.0, cy=0.0, cz=0.0):
    return cq.Workplane("XY").box(x, y, z).translate((cx, cy, cz))


def extrusion(length, profile="2020", axis="x", at=(0.0, 0.0, 0.0)):
    w, h, so, sd, bore = PROFILES.get(str(profile), PROFILES["2020"])
    bar = cq.Workplane("XY").rect(w, h).extrude(length)
    cells = [(0.0, 0.0)] if h == w else [(0.0, -h / 4), (0.0, h / 4)]
    for cx, cy in cells:
        bar = bar.cut(cq.Workplane("XY").center(cx, cy).circle(bore / 2).extrude(length))
        cw = w  # each 20/30 cell has a slot on every exposed face
        for dx, dy, sx, sy in ((cw / 2, 0, sd, so), (-cw / 2, 0, sd, so)):
            bar = bar.cut(_box(sx, sy, length, cx + dx, cy + dy, length / 2))
    for cy in (h / 2, -h / 2):
        bar = bar.cut(_box(so, sd, length, 0, cy, length / 2))
    try:
        bar = bar.edges("|Z").fillet(0.8)
    except Exception:
        pass
    if axis == "x":
        bar = bar.rotate((0, 0, 0), (0, 1, 0), 90)
    elif axis == "y":
        bar = bar.rotate((0, 0, 0), (1, 0, 0), -90)
    return bar.translate(tuple(at))


def sheet_bent(points, width, t=1.5):
    wire = cq.Wire.makePolygon([cq.Vector(x, 0, z) for x, z in points])
    outline = wire.offset2D(t / 2, "intersection")[0]
    face = cq.Face.makeFromWires(outline)
    return cq.Workplane("XY").add(cq.Solid.extrudeLinear(face, cq.Vector(0, width, 0)))


def panel(w, h, t=3.0, r=0.0, holes=()):
    p = cq.Workplane("XY").rect(w, h).extrude(t)
    if r > 0:
        try:
            p = p.edges("|Z").fillet(r)
        except Exception:
            pass
    for x, y, d in holes:
        p = p.cut(cq.Workplane("XY").center(x, y).circle(d / 2).extrude(t))
    return p


def nema17(length=40.0):
    body = _box(42.3, 42.3, length, 0, 0, -length / 2)
    try:
        body = body.edges("|Z").chamfer(4.0)
    except Exception:
        pass
    for sx in (-15.5, 15.5):
        for sy in (-15.5, 15.5):
            body = body.cut(cq.Workplane("XY").center(sx, sy).circle(1.5).extrude(-4.5))
    boss = cq.Workplane("XY").circle(11.0).extrude(2.0)
    shaft = cq.Workplane("XY").circle(2.5).extrude(24.0)
    out = body.union(boss).union(shaft)
    return _lib(out, "nema17", length=int(length)) if float(length) in (34, 40, 48, 60) else out


def esp32_devkit(kind="s3"):
    l, w = {"s3": (62.7, 25.4), "c3mini": (22.5, 18.0), "wroom": (51.5, 28.3)}.get(kind, (62.7, 25.4))
    pcb = _box(l, w, 1.6, 0, 0, 0.8)
    can = _box(min(18.0, l * 0.5), min(25.5, w - 2) if kind != "c3mini" else 12.0, 3.2, l / 2 - min(18.0, l * 0.5) / 2 - 1, 0, 3.2)
    usb = _box(7.5, 9.0, 3.2, -l / 2 + 3.0, 0, 3.2)
    out = pcb.union(can).union(usb)
    if kind != "c3mini":  # header pins underneath
        for sy in (-w / 2 + 1.3, w / 2 - 1.3):
            out = out.union(_box(l - 8, 2.5, 8.5, 0, sy, -4.25))
    lib = {"s3": ("esp32_s3_devkitc", {}), "c3mini": ("esp32_c3_supermini", {}), "wroom": ("esp32_devkitc", {"variant": "v1"})}
    key, params = lib.get(kind, lib["s3"])
    return _lib(out, key, **params)


def buck(kind="lm2596"):
    if kind == "mp1584":
        return _lib(_box(22.0, 17.0, 1.2, 0, 0, 0.6).union(_box(7, 7, 3.5, 2, 0, 2.95)), "mp1584")
    pcb = _box(43.0, 21.0, 1.6, 0, 0, 0.8)
    for x, y in ((-15.0, -7.5), (15.0, 7.5)):
        pcb = pcb.cut(cq.Workplane("XY").center(x, y).circle(1.5).extrude(2))
    cap = cq.Workplane("XY").circle(4.0).extrude(12.0).translate((-8, 3, 1.6))
    ind = _box(12, 12, 7, 6, -1, 5.1)
    return _lib(pcb.union(cap).union(ind), "lm2596")


def led_strip(length, width=10.0):
    tape = _box(length, width, 0.4, length / 2, 0, 0.2)
    n = max(1, int(length / 16.6))
    for i in range(n):
        tape = tape.union(_box(5.0, 5.0, 1.6, 8.3 + i * 16.6, 0, 1.2))
    return _lib(tape, "ws2812_strip", length=float(length)) if float(width) == 10.0 and 0 < float(length) <= 2000 else tape


def stepstick():
    pcb = _box(20.3, 15.2, 1.6, 0, 0, 0.8)
    sink = _box(9, 9, 5, 0, 0, 4.1)
    pins = _box(20.3, 2.5, 8.5, 0, -6.35, -4.25).union(_box(20.3, 2.5, 8.5, 0, 6.35, -4.25))
    return _lib(pcb.union(sink).union(pins), "tmc2209")
