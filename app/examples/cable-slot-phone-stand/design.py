import math
import cadquery as cq
from cadlib.dims import dim
from cadlib.refmodels import ref

SCENE = "desk"

PH = dim("iphone_16")          # phone for reference (71.6 x 147.6 x 7.8)
PLUG = dim("usbc_plug")        # USB-C overmould 12.35 x 6.5

W = 70.0          # stand width (X)
TILT = 20.0       # phone lean back from vertical, deg
LEDGE_Z = 40.0    # height of the phone's bottom edge: room for the plug below
GAP = 14.0        # ledge depth: phone + case
LIP_H, LIP_T = 8.0, 4.0
REST_L, REST_T = 100.0, 5.0
REST_W_H = 55.0   # backrest window height
WALL = 4.0
BACK_Y = 65.0     # back foot
FOOT_H = 2.5      # stick-on rubber feet
SLOT_W, SLOT_D = 14.0, 10.0   # cable slot through the ledge (fits USB-C overmould)

s, c = math.sin(math.radians(TILT)), math.cos(math.radians(TILT))
UP = (s, c)        # along the backrest, upward
FWD = (-c, s)      # along the ledge, toward the front
BACKN = (c, -s)    # backrest normal, pointing back


def add(p, d, k):
    return (p[0] + d[0] * k, p[1] + d[1] * k)


def meet(p, d, q, e):
    """intersection of lines p + t d and q + u e"""
    det = d[0] * (-e[1]) - d[1] * (-e[0])
    t = ((q[0] - p[0]) * (-e[1]) - (q[1] - p[1]) * (-e[0])) / det
    return add(p, d, t)


def profile():
    p0 = (0.0, LEDGE_Z)
    p1 = add(p0, FWD, GAP)
    p2 = add(p1, UP, LIP_H)
    p3 = add(p2, FWD, LIP_T)
    p4 = meet(p3, UP, (0, 0), (1, 0))                 # front foot
    top = add(p0, UP, REST_L)
    top_b = add(top, BACKN, REST_T)
    back = (BACK_Y, 0.0)
    outer = [p4, back, top_b, top, p0, p1, p2, p3]

    # lightening window: leaves an A-frame of WALL / REST_T thick members
    bdir = (top_b[0] - back[0], top_b[1] - back[1])
    bl = math.hypot(*bdir)
    bdir = (bdir[0] / bl, bdir[1] / bl)
    bin_ = (-bdir[1], bdir[0])                         # inward normal of back leg
    if bin_[0] > 0:
        bin_ = (-bin_[0], -bin_[1])
    front_in = add(p4, BACKN, WALL)
    rest_in = add(p0, BACKN, REST_T)
    back_in = add(back, bin_, WALL)
    floor = ((0, WALL), (1, 0))
    under = ((0, LEDGE_Z - 7), (1, 0))
    a = meet(front_in, UP, *floor)
    b = meet(front_in, UP, *under)
    cc = meet(rest_in, UP, *under)
    d = meet(rest_in, UP, back_in, bdir)
    e = meet(back_in, bdir, *floor)
    return outer, [a, b, cc, d, e], p0, (back, top_b)


def window(w, h, depth, ang, at):
    """rounded through-window, its depth axis tilted ang deg about X"""
    box = cq.Workplane("XY").box(w, depth, h)
    try:
        box = box.edges("|Y").fillet(min(w, h) / 2 - 0.5)
    except Exception:
        pass
    return box.rotate((0, 0, 0), (1, 0, 0), ang).translate((0, at[0], at[1]))


def body():
    outer, win, p0, (back, top_b) = profile()
    wp = lambda pts: (cq.Workplane("YZ", origin=(-W / 2, 0, 0))
                      .polyline(pts).close().extrude(W))
    b = wp(outer)
    try:
        b = b.edges("|X").fillet(2.0)
    except Exception:
        pass
    b = b.cut(wp(win).translate((-1, 0, 0)).union(wp(win).translate((1, 0, 0))))
    # cable slot through the ledge, square to it
    ctr = add(add(p0, FWD, 1.5 + SLOT_D / 2), UP, -8)
    slot = (cq.Workplane("XY").box(SLOT_W, SLOT_D, 30)
            .rotate((0, 0, 0), (1, 0, 0), -TILT)
            .translate((0, ctr[0], ctr[1])))
    b = b.cut(slot)
    # lightening windows in the backrest and the back leg (leave 11 mm side rails)
    mid = add(add(p0, UP, 20 + REST_W_H / 2), BACKN, REST_T / 2)
    b = b.cut(window(W - 22, REST_W_H, REST_T + 4, -TILT, mid))
    leg_ang = math.degrees(math.atan2(back[0] - top_b[0], top_b[1] - back[1]))
    lm = ((back[0] + top_b[0]) / 2, (back[1] + top_b[1]) / 2 - 8)
    b = b.cut(window(W - 22, 70, 20, leg_ang, lm))
    # cable exit through the back foot, at desk level
    b = b.cut(cq.Workplane("XY").box(10, 30, 9).translate((0, BACK_Y - 8, 3.5)))
    return b.translate((0, 0, FOOT_H)), p0


def parts():
    stand, p0 = body()
    # phone: back on the rest, bottom on the ledge
    hd = 10.5 / 2
    off = (hd * c, -hd * s)        # rotated bottom-back point of the phone box
    phone = ref("iphone_16", at=(0, p0[0] - off[0], p0[1] - off[1] + FOOT_H),
                rot=(-TILT, 0, 0))
    feet = None
    for x in (-W / 2 + 8, W / 2 - 8):
        for y in (-24.0, BACK_Y - 10):
            f = cq.Workplane("XY").circle(5).extrude(FOOT_H).translate((x, y, 0))
            feet = f if feet is None else feet.union(f)
    return [
        {"name": "Stand", "shape": stand, "group": "case", "color": "#e8e4dc"},
        {"name": "Rubber foot", "shape": feet, "group": "component",
         "material": "rubber", "color": "#222222"},
        phone,
    ]


ASSEMBLY = [["Stand"], ["Rubber foot"]]
