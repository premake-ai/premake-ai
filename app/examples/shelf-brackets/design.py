"""Floating-look shelf brackets (pair) for a 1x8 board (19 x 184 mm). Rated for books with
#10 screws into studs. Z up, mm, wall at +Y, shelf points to -Y. Print on the side.
"""
import cadquery as cq

THUMB_VIEW = "iso_low"

T = 11.0               # bracket thickness (X)
VERT, HORZ = 150.0, 176.0
BAR = 18.0
SPACING = 380.0
BOARD = (19.0, 184.0, 600.0)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


SCREW_Z = (40.0, 120.0)


def make_bracket(xc):
    outer = (cq.Workplane("YZ").polyline([(0, 0), (0, VERT), (-HORZ, VERT), (-HORZ, VERT - BAR),
                                          (-HORZ + 20, VERT - BAR - 4), (-BAR - 4, 20), (-BAR, 0)]).close()
             .extrude(T).translate((-T / 2, 0, 0)))
    # quarter-circle window in the gusset
    win = (cq.Workplane("YZ").moveTo(-BAR - 6, VERT - BAR - 6).lineTo(-BAR - 6, 48)
           .threePointArc((-BAR - 30, VERT - BAR - 54), (-HORZ + 52, VERT - BAR - 6)).close()
           .extrude(T + 2).translate((-T / 2 - 1, 0, 0)))
    b = outer.cut(win)
    b = try_fillet(b, "|X", 3.0)
    b = try_fillet(b, "<X or >X", 1.2)
    for z in SCREW_Z:
        b = b.cut(cq.Workplane("XZ").center(0, z).circle(2.7).extrude(-BAR - 2).translate((0, -BAR - 1, 0)))
        b = b.cut(cq.Workplane("XZ").center(0, z).circle(5.5).extrude(-BAR + 6).translate((0, -BAR - 1, 0)))
    for y in (-50.0, -140.0):
        b = b.cut(cq.Workplane("XY").center(0, y).circle(2.0).extrude(10).translate((0, 0, VERT - 9)))
    return b.translate((xc, 0, 0))


def make_board():
    t, d, l = BOARD
    return try_fillet(box(-l / 2, l / 2, -d - 2, -2, VERT, VERT + t), "|X", 1.5)


def make_screws():
    out = None
    for xc in (-SPACING / 2, SPACING / 2):
        for z in SCREW_Z:
            s = cq.Workplane("XZ").center(xc, z).circle(2.4).extrude(-70).translate((0, -BAR + 6 + 0.0, 0))
            h = cq.Workplane("XZ").center(xc, z).circle(4.8).extrude(-3).translate((0, -BAR + 6 - 3, 0))
            out = s.union(h) if out is None else out.union(s).union(h)
    return out


def parts():
    return [
        {"name": "Bracket left", "shape": make_bracket(-SPACING / 2), "group": "case", "color": "#1b1b1e",
         "explode": [-0.3, 0, -1]},
        {"name": "Bracket right", "shape": make_bracket(SPACING / 2), "group": "case", "color": "#1b1b1e",
         "explode": [0.3, 0, -1]},
        {"name": "Pine board 1x8 x 24 in", "shape": make_board(), "group": "component", "color": "#d9b382",
         "explode": [0, 0, 1]},
        {"name": "#10 x 3 in wood screws (4x)", "shape": make_screws(), "group": "component", "color": "#b0b5bb",
         "explode": [0, -1, 0]},
    ]
