"""Laptop stand: two printed side frames joined by 1/2 in oak dowels. Raises the back of a
laptop ~75 mm (about 17 deg). Z up, mm, front faces -Y. Sides print flat (X face down).
"""
import math
import cadquery as cq

SPAN = 250.0          # distance between the side frames (outer)
T = 10.0              # frame thickness (X)
L = 230.0             # depth
H_BACK, H_FRONT = 82.0, 16.0
DOWEL_D = 12.7
DOWEL_CLR = 13.1


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def slope_z(y):
    return H_FRONT + (H_BACK - H_FRONT) * (y + L / 2) / L


def dowel_pts():
    return [(-80.0, slope_z(-80.0) - 14), (100.0, slope_z(100.0) - 13)]


def make_side(xc):
    prof = [(-L / 2, 0), (L / 2, 0), (L / 2, H_BACK), (-L / 2 + 10, H_FRONT), (-L / 2 + 10, H_FRONT + 14),
            (-L / 2, H_FRONT + 14)]
    s = cq.Workplane("YZ").polyline(prof).close().extrude(T).translate((-T / 2, 0, 0))
    # lightening window
    win = (cq.Workplane("YZ").polyline([(-50, 10), (L / 2 - 30, 10), (L / 2 - 30, slope_z(L / 2 - 30) - 16),
                                         (-50, slope_z(-50) - 16)]).close()
           .extrude(T + 2).translate((-T / 2 - 1, 0, 0)))
    s = s.cut(win)
    s = try_fillet(s, "|X", 3.0)
    s = try_fillet(s, "<X or >X", 1.0)
    for y, z in dowel_pts():
        s = s.cut(cq.Workplane("YZ").center(y, z).circle(DOWEL_CLR / 2).extrude(T + 2).translate((-T / 2 - 1, 0, 0)))
    return s.translate((xc, 0, 0))


def make_dowels():
    out = None
    for y, z in dowel_pts():
        d = cq.Workplane("YZ").center(y, z).circle(DOWEL_D / 2).extrude(SPAN + 10).translate((-SPAN / 2 - 5, 0, 0))
        out = d if out is None else out.union(d)
    return out


def make_feet():
    out = None
    for xc in (-SPAN / 2 + T / 2, SPAN / 2 - T / 2):
        for y in (-L / 2 + 14, L / 2 - 14):
            f = cq.Workplane("XY").center(xc, y).rect(9, 20).extrude(1.5).translate((0, 0, -1.5))
            out = f if out is None else out.union(f)
    return out


def make_laptop():
    ang = math.degrees(math.atan2(H_BACK - H_FRONT, L))
    lap = cq.Workplane("XY").box(310, 215, 16).edges("|Z").fillet(8).translate((0, 0, 8))
    return lap.rotate((0, 0, 0), (1, 0, 0), ang).translate((0, 6, H_FRONT + 2 + 4))


def parts():
    return [
        {"name": "Side frame left", "shape": make_side(-SPAN / 2 + T / 2), "group": "case", "color": "#6c757d",
         "explode": [-1, 0, 0]},
        {"name": "Side frame right", "shape": make_side(SPAN / 2 - T / 2), "group": "case", "color": "#6c757d",
         "explode": [1, 0, 0]},
        {"name": "1/2 in oak dowels (2x 260 mm)", "shape": make_dowels(), "group": "component", "color": "#c69c6d",
         "explode": [0, 0, 1]},
        {"name": "Rubber feet strips (4x)", "shape": make_feet(), "group": "component", "color": "#222222",
         "explode": [0, 0, -1]},
    ]
