"""Under-desk headphone hook with a cable wrap notch. Screws to the underside of a desk.

Z up, mm. Desk underside at z = TOP. Saddle points to -Y (toward the user).
Print on its side (X face down) - no supports.
"""
import cadquery as cq

W = 34.0               # width (X)
TOP = 78.0             # desk underside
PLATE_T = 7.0
PLATE_Y = (0.0, 78.0)
STEM_Y = (0.0, 11.0)
SADDLE_Y0 = -62.0
SADDLE_T = 10.0
LIP_H = 20.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


SCREW_Y = (36.0, 64.0)


def make_hook():
    pts = [(PLATE_Y[1], TOP), (PLATE_Y[1], TOP - PLATE_T), (STEM_Y[1] + 14, TOP - PLATE_T),
           (STEM_Y[1], TOP - PLATE_T - 14), (STEM_Y[1], SADDLE_T + 10), (STEM_Y[1] - 4, 0),
           (SADDLE_Y0 + 6, 0), (SADDLE_Y0, 6), (SADDLE_Y0, LIP_H), (SADDLE_Y0 + 8, LIP_H),
           (SADDLE_Y0 + 9, SADDLE_T), (STEM_Y[0], SADDLE_T), (STEM_Y[0], TOP)]
    h = cq.Workplane("YZ").polyline(pts).close().extrude(W).translate((-W / 2, 0, 0))
    h = try_fillet(h, "|X", 3.0)
    h = try_fillet(h, "<X or >X", 2.5)
    # cable notch on the stem back
    h = h.cut(box(-5, 5, STEM_Y[1] - 4, STEM_Y[1] + 2, 30, 46))
    for y in SCREW_Y:
        h = h.cut(cq.Workplane("XY").center(0, y).circle(2.2).extrude(PLATE_T + 2).translate((0, 0, TOP - PLATE_T - 1)))
        h = h.cut(cq.Workplane("XY").add(cq.Solid.makeCone(4.6, 2.2, 2.4, cq.Vector(0, y, TOP - PLATE_T - 0.01),
                                                            cq.Vector(0, 0, 1))))
    return h


def make_desk():
    return box(-70, 70, -40, 110, TOP, TOP + 18)


def make_screws():
    out = None
    for y in SCREW_Y:
        s = cq.Workplane("XY").center(0, y).circle(2.0).extrude(16).translate((0, 0, TOP - PLATE_T + 1)).union(
            cq.Workplane("XY").add(cq.Solid.makeCone(4.3, 2.0, 2.2, cq.Vector(0, y, TOP - PLATE_T + 0.2), cq.Vector(0, 0, 1))))
        out = s if out is None else out.union(s)
    return out


def make_pad():
    return box(-W / 2 + 3, W / 2 - 3, SADDLE_Y0 + 10, STEM_Y[0] - 3, SADDLE_T, SADDLE_T + 1.5)


def parts():
    return [
        {"name": "Headphone hook", "shape": make_hook(), "group": "case", "color": "#9b8cff", "explode": [0, 0, -1]},
        {"name": "Felt pad strip", "shape": make_pad(), "group": "component", "color": "#444a55", "explode": [0, 0, 1]},
        {"name": "#8 x 5/8 in wood screws (2x)", "shape": make_screws(), "group": "component", "color": "#b0b5bb",
         "explode": [0, 0, 1]},
    ]
