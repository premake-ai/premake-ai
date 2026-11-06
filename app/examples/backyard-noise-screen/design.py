import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info

SCENE = "floor"

# Backyard privacy / noise screen, one 1.04 m bay, styled after a highway
# noise wall: opaque grey lower panels with engraved diagonal tiles,
# clear upper panels, 2040 aluminium posts on ground-spike anchors.
BAY = 1000.0             # rail length (inner width between posts)
POST_H = 1200.0
RAIL_Z = [170.0, 490.0, 810.0, 1130.0]  # rail centres, 320 pitch -> 300 stile pieces; clear of spike
PT = fab.sheet_actual("acrylic", 6)
PW = BAY / 2             # each panel 500 x 370
PH = RAIL_Z[1] - RAIL_Z[0]
PY = -10.0               # rail front face
HOLE = 7.0               # oversize for acrylic thermal movement
GD, GS, GW = 1.0, 14.0, 2.0  # engraved groove depth / spacing / width
TILE = PW / 4
SLEEVE = 50.0            # ground-spike socket (50 mm square posts)
SLEEVE_H = 150.0
ADAPT_H = 70.0          # collar at the sleeve mouth; spike bolts clamp through it
ADAPT_Z = SLEEVE_H - ADAPT_H


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def panel_holes(x0, z0):
    xs = [x0 + 25, x0 + PW / 2, x0 + PW - 25]
    return [(x, z0 + 10) for x in xs] + [(x, z0 + PH - 10) for x in xs]


def panel(x0, z0, engraved):
    p = box(x0, x0 + PW, PY - PT, PY, z0, z0 + PH)
    for x, z in panel_holes(x0, z0):
        p = p.cut(cq.Workplane("XZ").center(x, z).circle(HOLE / 2)
                  .extrude(-(PT + 2)).translate((0, PY + 1, 0)))
    if engraved:
        cuts = []
        nz = 3
        th = (PH - 40) / nz
        for i in range(4):
            for j in range(nz):
                cx = x0 + (i + 0.5) * TILE
                cz = z0 + 20 + (j + 0.5) * th
                ang = 45 if (i + j) % 2 else -45
                n = int((TILE + th) / GS) + 1
                lines = [cq.Solid.makeBox(TILE * 2, 2 * GD, GW, cq.Vector(-TILE, -GD, -GW / 2))
                         .translate(cq.Vector(0, 0, k * GS))
                         .rotate(cq.Vector(0, 0, 0), cq.Vector(0, 1, 0), ang)
                         .translate(cq.Vector(cx, PY - PT, cz)) for k in range(-n, n + 1)]
                clip = cq.Solid.makeBox(TILE - 8, 2 * GD, th - 8,
                                        cq.Vector(cx - TILE / 2 + 4, PY - PT - GD, cz - th / 2 + 4))
                cuts.append(cq.Compound.makeCompound(lines).intersect(clip))
        p = p.cut(cq.Compound.makeCompound(cuts))
    return p


def adapter(x):
    a = box(x - SLEEVE / 2 + 0.5, x + SLEEVE / 2 - 0.5, -SLEEVE / 2 + 0.5, SLEEVE / 2 - 0.5, 0, ADAPT_H)
    a = a.cut(box(x - 10.3, x + 10.3, -20.3, 20.3, -1, ADAPT_H + 1))
    for s in (-1, 1):  # lighten the thick side blocks, 2.5 mm walls left
        x0, x1 = sorted((x + s * 12.8, x + s * 21.5))
        a = a.cut(box(x0, x1, -21.5, 21.5, -1, ADAPT_H + 1))
    try:
        a = a.edges("|Z").fillet(2)
    except Exception:
        pass
    return a.translate((0, 0, ADAPT_Z))


def sleeve(x):
    s = box(x - SLEEVE / 2 - 2, x + SLEEVE / 2 + 2, -SLEEVE / 2 - 2, SLEEVE / 2 + 2, 0, SLEEVE_H)
    return s.cut(box(x - SLEEVE / 2, x + SLEEVE / 2, -SLEEVE / 2, SLEEVE / 2, 2, SLEEVE_H + 1))


def parts():
    px = BAY / 2 + 10
    out = []
    for s, nm in ((-1, "Left"), (1, "Right")):
        x = s * px
        out.append({"name": f"{nm} post", "shape": fab.extrusion(POST_H, profile="2040", axis="z",
                    at=(x, 0, 2)),
                    "process": "extrusion", "params": {"profile": "2040", "length_mm": 1200, "tapped_ends": 0}})
        out.append({"name": f"{nm} post adapter", "shape": adapter(x), "color": "#3a3d40"})
        out.append({"name": f"{nm} ground spike", "shape": sleeve(x), "group": "component",
                    "color": "#2b2b2b"})
    for i, z in enumerate(RAIL_Z):
        out.append({"name": f"Rail {i + 1}", "id": f"rail{i + 1}",
                    "shape": fab.extrusion(BAY, profile="2020", axis="x", at=(-BAY / 2, 0, z)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 1000, "tapped_ends": 0}})
    for i in range(3):
        z0 = RAIL_Z[i] + 10
        out.append({"name": f"Mid stile {i + 1}", "id": f"stile{i + 1}",
                    "shape": fab.extrusion(300, profile="2020", axis="z", at=(0, 0, z0)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": 300, "tapped_ends": 0}})
    for row in range(3):
        for col in range(2):
            x0 = -BAY / 2 + col * PW
            z0 = RAIL_Z[row]
            low = row == 0
            out.append({"name": "Lower panel" if low else "Upper panel",
                        "id": f"panel{row}{col}",
                        "shape": panel(x0, z0, low), "process": "laser",
                        "params": {"material": "acrylic", "thickness_mm": 6},
                        "material": "acrylic_frosted" if low else "acrylic_clear",
                        "color": "#9a9a95" if low else None,
                        "explode": [0, -1, 0]})
    return out


ASSEMBLY = [["Left ground spike", "Right ground spike"], ["Left post adapter", "Right post adapter"],
            ["Left post", "Right post"], ["Rail 1", "Rail 2", "Rail 3", "Rail 4"],
            ["Mid stile 1", "Mid stile 2", "Mid stile 3"], ["Lower panel", "Upper panel"]]
