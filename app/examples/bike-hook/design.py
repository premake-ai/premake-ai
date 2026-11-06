"""Wall bike hook: hangs a bike by its front wheel. One printed part + rubber pad.

Z up, mm. Wall is the +Y side (plate back at y = PLATE_T), hook points to -Y.
Print on its side (X face down) - no supports.
"""
import cadquery as cq

PLATE_W, PLATE_H, PLATE_T = 64.0, 120.0, 7.0
HOOK_W = 24.0
REACH = 118.0          # wall to inside of the tip
TIP_H = 82.0
ARM_Z0, ARM_Z1 = 36.0, 54.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


SCREWS = [(0.0, 104.0), (-23.0, 16.0), (23.0, 16.0)]   # (x, z)


def make_hook():
    plate = box(-PLATE_W / 2, PLATE_W / 2, 0, PLATE_T, 0, PLATE_H)
    plate = try_fillet(plate, "|Y", 12.0)
    plate = try_fillet(plate, "<Y", 2.5)
    pts = [(0.5, 6.0), (-58.0, ARM_Z0), (-REACH, ARM_Z0), (-REACH - 16, ARM_Z0 + 6),
           (-REACH - 16, TIP_H), (-REACH, TIP_H), (-REACH + 2, ARM_Z1), (0.5, ARM_Z1 + 20)]
    arm = (cq.Workplane("YZ").polyline(pts).close().extrude(HOOK_W).translate((-HOOK_W / 2, 0, 0)))
    arm = try_fillet(arm, "|X", 5.0)
    arm = try_fillet(arm, "<X or >X", 3.0)
    h = plate.union(arm)
    for x, z in SCREWS:
        hole = cq.Workplane("XZ").center(x, z).circle(2.6).extrude(-PLATE_T - 2).translate((0, -1, 0))
        csk = cq.Workplane("XY").add(cq.Solid.makeCone(5.4, 2.6, 2.8, cq.Vector(x, -0.01, z), cq.Vector(0, 1, 0)))
        h = h.cut(hole).cut(csk)
    # pad recess on the arm top
    h = h.cut(box(-HOOK_W / 2 + 3, HOOK_W / 2 - 3, -REACH + 4, -12, ARM_Z1 - 0.8, ARM_Z1 + 30)
              .intersect(box(-50, 50, -REACH + 4, -12, ARM_Z1 - 0.8, ARM_Z1 + 0.01 + 1.0)))
    return h


def make_pad():
    return box(-HOOK_W / 2 + 3.2, HOOK_W / 2 - 3.2, -REACH + 4.5, -12.5, ARM_Z1 - 0.8, ARM_Z1 + 1.6)


def make_screws():
    out = None
    for x, z in SCREWS:
        s = (cq.Workplane("XZ").center(x, z).circle(2.3).extrude(-62).translate((0, 0, 0))
             .union(cq.Workplane("XY").add(cq.Solid.makeCone(5.2, 2.3, 2.6, cq.Vector(x, 0.2, z), cq.Vector(0, 1, 0)))))
        out = s if out is None else out.union(s)
    return out


def parts():
    return [
        {"name": "Bike hook", "shape": make_hook(), "group": "case", "color": "#2f6fdf", "explode": [0, -1, 0]},
        {"name": "Rubber pad strip", "shape": make_pad(), "group": "component", "color": "#1d1d1d", "explode": [0, 0, 1]},
        {"name": "#10 x 2-1/2 in wood screws (3x)", "shape": make_screws(), "group": "component",
         "color": "#b0b5bb", "explode": [0, -1, 0]},
    ]
