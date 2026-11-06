"""Bike bottle cage for standard 74 mm bottles. Mounts on the usual 64 mm M5 bosses.
Z up (along the down tube), mm, frame side is +Y. Prints standing on its back spine, no supports.
"""
import math
import cadquery as cq

THUMB_VIEW = "iso"

BOTTLE_R = 37.3
WALL = 3.2
H = 128.0
SPINE_W, SPINE_T = 22.0, 4.5
BOSS = (30.0, 94.0)       # M5 slot centres (64 mm apart)
CUP_Z = 6.0


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


YC = -(BOTTLE_R + 1.0)    # bottle axis y


def make_cage():
    ring = (cq.Workplane("XY").circle(BOTTLE_R + WALL).circle(BOTTLE_R).extrude(H - 30).translate((0, YC, CUP_Z)))
    # front opening + side windows
    ring = ring.cut(cq.Workplane("XY").polyline([(0, YC), (-60, YC - 80), (60, YC - 80)]).close()
                    .extrude(H).translate((0, 0, CUP_Z + 14)))
    for s in (-1, 1):
        a = math.radians(-20)
        win = (cq.Workplane("YZ").center(YC + 2, CUP_Z + 52).slot2D(66, 22, 90).extrude(60)
               .translate((0 if s > 0 else -60, 0, 0)))
        ring = ring.cut(win)
    # bottom cup
    cup = (cq.Workplane("XY").circle(BOTTLE_R + WALL).extrude(CUP_Z).translate((0, YC, 0))
           .cut(cq.Workplane("XY").circle(16).extrude(CUP_Z + 2).translate((0, YC - 6, -1))))
    # spine
    spine = box(-SPINE_W / 2, SPINE_W / 2, -SPINE_T, 0, 0, H)
    spine = try_fillet(spine, "|Y", 6.0)
    # top retaining hook
    hook = (cq.Workplane("YZ").polyline([(-SPINE_T, H - 18), (-SPINE_T, H), (-24, H - 6), (-24, H - 14)]).close()
            .extrude(SPINE_W - 4).translate((-SPINE_W / 2 + 2, 0, 0)))
    c = ring.union(cup).union(spine).union(hook)
    c = try_fillet(c, "|Z", 1.0)
    for z in BOSS:
        c = c.cut(cq.Workplane("XZ").center(0, z).slot2D(9.5, 5.4, 90).extrude(-SPINE_T - 2).translate((0, -SPINE_T - 1, 0)))
        c = c.cut(cq.Workplane("XZ").center(0, z).slot2D(15, 10.5, 90).extrude(-6).translate((0, -SPINE_T - 7, 0)))
    return c


def make_bottle():
    b = cq.Workplane("XY").circle(BOTTLE_R - 0.3).extrude(200).edges().fillet(10).translate((0, YC, CUP_Z + 0.2))
    cap = cq.Workplane("XY").circle(14).extrude(22).translate((0, YC, CUP_Z + 199))
    return b.union(cap)


def make_bolts():
    out = None
    for z in BOSS:
        b = (cq.Workplane("XZ").center(0, z).circle(2.5).extrude(12).translate((0, 6, 0))
             .union(cq.Workplane("XZ").center(0, z).circle(4.25).extrude(5).translate((0, -SPINE_T + 0.1, 0))))
        out = b if out is None else out.union(b)
    return out


def make_tube():
    return cq.Workplane("XY").circle(19).extrude(260).translate((0, 19 + 0.5, -60))


def parts():
    return [
        {"name": "Bottle cage", "shape": make_cage(), "group": "case", "color": "#06d6a0", "explode": [0, -1, 0]},
        {"name": "M5 x 12 stainless bolts (2x)", "shape": make_bolts(), "group": "component", "color": "#b0b5bb",
         "explode": [0, -1, 0]},
    ]
