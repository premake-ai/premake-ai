import math
import cadquery as cq
from cadlib.parts import part
from cadlib.shapes import safe_fillet

SCENE = "desk"
OFF = 4.0              # rubber feet height
DISC_D, DISC_T = 150, 3.0   # two stacked steel discs = the weighted base
HUB_D, HUB_H = 72, 22
FOOT_Y = 22            # hub / upright foot centre (y)
SOCK = 10              # socket depth in hub
Z_TOP = 250            # top of upright
SEC_W, SEC_D, SEC_R = 26, 14, 4.5  # upright section (X, Y, corner r)
WALL = 2.0
HOOK_L, HOOK_W, HOOK_T, DROOP = 115, 26, 8, 12
PAD_T, LIP = 3.0, 4.0
COLOR = "#2b2d31"

Z_HUB = OFF + 2 * DISC_T          # hub bottom
Z0 = Z_HUB + HUB_H - SOCK         # upright bottom
HUB_SCREWS = [(26 * math.cos(math.radians(a)), FOOT_Y + 26 * math.sin(math.radians(a))) for a in (45, 135, 225, 315)]
FOOT_SCREWS = [(-7, FOOT_Y), (7, FOOT_Y)]
TOP_SCREWS = [(-7, 0), (7, 0)]


def rrect(w, d, r, z=0, y=0):
    return (cq.Workplane("XY").workplane(offset=z).center(0, y)
            .sketch().rect(w, d).vertices().fillet(r).finalize())


def cyl(x, y, z, d, h):
    return cq.Workplane("XY").workplane(offset=z).center(x, y).circle(d / 2).extrude(h)


def path():
    return cq.Workplane("YZ").spline(
        [(FOOT_Y, Z0), (FOOT_Y, Z0 + 25), (38, 130), (12, 215), (0, Z_TOP)],
        tangents=[(0, 1), (0, 1)])


def disc(z):
    d = cyl(0, 0, z, DISC_D, DISC_T)
    for x, y in HUB_SCREWS:
        d = d.cut(cyl(x, y, z - 1, 4.5, DISC_T + 2))
    return d


def hub():
    h = cyl(0, FOOT_Y, Z_HUB, HUB_D, HUB_H)
    h = safe_fillet(h, ">Z", 14)
    # hollow underside, stepped to follow the domed top with a 2.4 mm skin
    h = h.cut(cyl(0, FOOT_Y, Z_HUB, HUB_D - 4.8, 8))
    h = h.cut(cyl(0, FOOT_Y, Z_HUB, HUB_D - 12, 14))
    h = h.cut(cyl(0, FOOT_Y, Z_HUB, HUB_D - 28, HUB_H - 2.4))
    # socket walls (4 mm floor) + screw bosses
    h = h.union(rrect(SEC_W + 8, SEC_D + 8, 6, Z0 - 4, FOOT_Y).extrude(SOCK + 2))
    for x, y in FOOT_SCREWS:
        h = h.union(cyl(x, y, Z_HUB, 10, Z0 - Z_HUB))
    for x, y in HUB_SCREWS:
        h = h.union(cyl(x, y, Z_HUB, 9, 12)).cut(cyl(x, y, Z_HUB - 1, 3.3, 12))
    h = h.cut(rrect(SEC_W + 0.6, SEC_D + 0.6, SEC_R + 0.3, Z0, FOOT_Y).extrude(SOCK + 1))
    for x, y in FOOT_SCREWS:
        h = h.cut(cyl(x, y, Z_HUB - 1, 8.6, 4.5)).cut(cyl(x, y, Z_HUB, 4.5, 20))
    return h


def upright():
    outer = rrect(SEC_W, SEC_D, SEC_R, Z0, FOOT_Y).sweep(path())
    inner = rrect(SEC_W - 2 * WALL, SEC_D - 2 * WALL, SEC_R - WALL, Z0, FOOT_Y).sweep(path())
    slab = lambda za, zb: cq.Workplane("XY").box(200, 200, zb - za).translate((0, 0, (za + zb) / 2))
    u = outer.cut(inner).union(outer.intersect(slab(Z0 - 1, Z0 + 20))).union(outer.intersect(slab(Z_TOP - 14, Z_TOP + 1)))
    # cable clip on the back: J hook opening up, 6 mm channel, 4 mm snap mouth
    yb = 38 + SEC_D / 2
    clip = (cq.Workplane("YZ").polyline([
        (yb - 4, 118), (yb + 14, 118), (yb + 14, 138), (yb + 4, 138), (yb + 4, 134),
        (yb + 8, 134), (yb + 8, 124), (yb - 4, 124)]).close().extrude(7, both=True))
    clip = safe_fillet(clip, "|X", 1)
    u = u.union(clip)
    for x, y in FOOT_SCREWS:
        u = u.cut(cyl(x, y, Z0 - 1, 3.3, 15))
    for x, y in TOP_SCREWS:
        u = u.cut(cyl(x, y, Z_TOP - 11, 3.3, 12))
    return u


def arc_band(r_off, t, w):
    """Arched band along X (top surface drooping DROOP at the ends), y +-w/2."""
    L = HOOK_L / 2
    zc = Z_TOP + 3 + HOOK_T + r_off
    prof = (cq.Workplane("XZ").moveTo(-L, zc - DROOP).threePointArc((0, zc), (L, zc - DROOP))
            .lineTo(L, zc - DROOP + t).threePointArc((0, zc + t), (-L, zc - DROOP + t)).close())
    return prof.extrude(w / 2, both=True)


def hook():
    h = safe_fillet(arc_band(-HOOK_T, HOOK_T, HOOK_W), "|Y", 4)
    seat = cq.Workplane("XY").box(SEC_W + 6, SEC_D + 8, 4.5).translate((0, 0, Z_TOP + 2.25))
    h = h.union(safe_fillet(seat, "|Z", 3))
    for x, y in TOP_SCREWS:
        h = h.cut(cyl(x, y, Z_TOP - 1, 4.5, 20)).cut(cyl(x, y, Z_TOP + 7, 8.6, 10))
    return h


def pad():
    p = arc_band(-LIP, LIP + PAD_T, HOOK_W + 2 * 2.4)
    p = p.cut(arc_band(-LIP - 1, LIP + 1, HOOK_W + 0.2))
    return safe_fillet(p, ">Z", 1.2)


def parts():
    feet = None
    for a in (0, 90, 180, 270):
        f = cyl(64 * math.cos(math.radians(a)), 64 * math.sin(math.radians(a)), 0, 12.7, OFF)
        feet = f if feet is None else feet.union(f)
    steel = {"process": "sheet", "params": {"material": "mild steel", "thickness_mm": 3, "bends": 0},
             "material": "steel", "color": "#3a3c40", "explode": [0, 0, -1]}
    return [
        {"name": "Weight disc (top)", "shape": disc(OFF + DISC_T), **steel},
        {"name": "Weight disc (bottom)", "shape": disc(OFF), **steel},
        {"name": "Hub", "shape": hub(), "color": COLOR, "explode": [0, 0, 1]},
        {"name": "Upright", "shape": upright(), "color": COLOR, "explode": [0, 0, 1]},
        {"name": "Hook", "shape": hook(), "color": COLOR, "explode": [0, 0, 1]},
        {"name": "Hook pad", "shape": pad(), "color": "#8a8f98", "material": "rubber", "explode": [0, 0, 1]},
        {"name": "Rubber feet", "shape": feet, "group": "component", "color": "#111111", "material": "rubber",
         "explode": [0, 0, -1]},
        part("m4x16_selftap", at=[(x, y, OFF) for x, y in HUB_SCREWS], rot=(180, 0, 0)),
        part("m4x20_selftap", at=[(x, y, Z_HUB + 3.5) for x, y in FOOT_SCREWS], rot=(180, 0, 0)),
        part("m4x16_selftap", at=[(x, y, Z_TOP + 7) for x, y in TOP_SCREWS]),
    ]


ASSEMBLY = [["Hub"], ["Upright"], ["Weight disc (top)", "Weight disc (bottom)"], ["Rubber feet"],
            ["Hook"], ["Hook pad"]]
