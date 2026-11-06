"""Modular drawer bins: three bins on a 40 mm grid that tile a 240 x 160 mm drawer section.

Z up, mm. Each bin prints open side up, 2 walls, no supports.
"""
import cadquery as cq

H = 44.0
WALL = 1.5
FLOOR = 1.6
R_OUT = 6.0
GAP = 0.6

# (name, x0, y0, sx, sy, dividers along X, color)
BINS = [
    ("Long bin", -120.0, -80.0, 160.0, 80.0, 2, "#ff9f1c"),
    ("Square bin", 40.0, -80.0, 80.0, 80.0, 0, "#2ec4b6"),
    ("Wide bin", -120.0, 0.0, 240.0, 80.0, 3, "#cbf3f0"),
]


def make_bin(x0, y0, sx, sy, ndiv):
    sx -= GAP
    sy -= GAP
    b = cq.Workplane("XY").box(sx, sy, H, centered=(False, False, False))
    b = b.edges("|Z").fillet(R_OUT).faces("<Z").edges().fillet(1.0)
    inner = (cq.Workplane("XY").box(sx - 2 * WALL, sy - 2 * WALL, H, centered=(False, False, False))
             .edges("|Z").fillet(R_OUT - WALL).faces("<Z").edges().fillet(4.0)
             .translate((WALL, WALL, FLOOR)))
    b = b.cut(inner)
    pitch = sx / (ndiv + 1)
    for i in range(1, ndiv + 1):
        d = (cq.Workplane("XY").box(WALL, sy - 2 * WALL + 0.2, H - 10, centered=(True, False, False))
             .translate((pitch * i, WALL - 0.1, FLOOR - 0.1)))
        b = b.union(d)
    # finger scoop notch at the front
    b = b.cut(cq.Workplane("XZ").center(sx / 2, H).ellipse(14, 9).extrude(-WALL - 2).translate((0, -1, 0)))
    return b.translate((x0 + GAP / 2, y0 + GAP / 2, 0))


def make_drawer():
    floor = cq.Workplane("XY").box(250, 170, 3).translate((0, 0, -1.5))
    return floor


def parts():
    out = []
    for name, x0, y0, sx, sy, nd, col in BINS:
        out.append({"name": name, "shape": make_bin(x0, y0, sx, sy, nd), "group": "case", "color": col})
    out.append({"name": "Drawer liner (cork, optional)", "shape": make_drawer(), "group": "component",
                "color": "#c8a27a", "explode": [0, 0, -1]})
    return out
