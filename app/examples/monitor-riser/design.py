"""Monitor riser: two printed arch legs + a 1x10 pine board (19 x 235 mm) from the hardware store.

Z up, mm, front faces -Y. Legs print on their side (X face down), no supports.
"""
import cadquery as cq

THUMB_VIEW = "iso_low"

BOARD_T, BOARD_D, BOARD_L = 19.0, 235.0, 610.0
LEG_H = 92.0           # top of leg = underside of board
SLAB = 9.0             # leg web thickness (X)
FLANGE_W, FLANGE_T = 34.0, 4.0
LIP = 6.0
LEG_X = 220.0          # leg centre distance from middle
D = BOARD_D + 2 * 3.0  # leg depth incl. lips


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def make_leg(xc):
    web = box(-SLAB / 2, SLAB / 2, -D / 2, D / 2, 0, LEG_H)
    arch = (cq.Workplane("YZ").moveTo(-D / 2 + 26, 0).lineTo(-D / 2 + 26, 30)
            .threePointArc((0, LEG_H - 22), (D / 2 - 26, 30)).lineTo(D / 2 - 26, 0).close()
            .extrude(40).translate((-20, 0, 0)))
    web = web.cut(arch)
    top = box(-FLANGE_W / 2, FLANGE_W / 2, -D / 2, D / 2, LEG_H - FLANGE_T, LEG_H)
    lips = [box(-FLANGE_W / 2, FLANGE_W / 2, s * D / 2 - (3.0 if s > 0 else 0), s * D / 2 + (0 if s > 0 else 3.0),
                LEG_H - 1, LEG_H + LIP) for s in (-1, 1)]
    feet = [box(-FLANGE_W / 2, FLANGE_W / 2, s * D / 2 - (26 if s > 0 else 0), s * D / 2 + (0 if s > 0 else 26),
                0, FLANGE_T) for s in (-1, 1)]
    leg = web.union(top)
    for p in lips + feet:
        leg = leg.union(p)
    leg = try_fillet(leg, "|X", 1.5)
    # screw holes up into the board
    for y in (-60.0, 60.0):
        leg = leg.cut(cq.Workplane("XY").center(0, y).circle(2.2).extrude(10).translate((0, 0, LEG_H - 8)))
    return leg.translate((xc, 0, 0))


def make_board():
    b = box(-BOARD_L / 2, BOARD_L / 2, -BOARD_D / 2, BOARD_D / 2, LEG_H, LEG_H + BOARD_T)
    return try_fillet(b, "|X", 2.0)


def make_pads():
    out = None
    for xc in (-LEG_X, LEG_X):
        for s in (-1, 1):
            p = box(xc - 14, xc + 14, s * (D / 2 - 13) - 10, s * (D / 2 - 13) + 10, -1.5, 0)
            out = p if out is None else out.union(p)
    return out


def parts():
    return [
        {"name": "Leg left", "shape": make_leg(-LEG_X), "group": "case", "color": "#3d5a80", "explode": [-1, 0, 0]},
        {"name": "Leg right", "shape": make_leg(LEG_X), "group": "case", "color": "#3d5a80", "explode": [1, 0, 0]},
        {"name": "Pine board 1x10 x 24 in", "shape": make_board(), "group": "component", "color": "#e0c097",
         "explode": [0, 0, 1]},
        {"name": "Felt pads (4x)", "shape": make_pads(), "group": "component", "color": "#555555", "explode": [0, 0, -1]},
    ]
