"""Rear-seat iPad holder for 2019-2025 Toyota RAV4 front headrests.

Coordinates: headrest posts at y=0 (vertical), kids sit at -Y, the iPad
screen faces -Y. Cradle parts are built in a local frame (plate front face
y=0, bottom-wedge apex z=0) and moved to their global place with G().
"""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "floor"

# --- car (forum-sourced Toyota numbers, clamps slide on the bar to suit) ---
POST_D = 14.0          # modern Toyota headrest stay diameter
POST_SPACING = 150.0   # Toyota stay pitch
BORE = 16.0            # post bore: 14 mm post + 1 mm EPDM tape each side
BAR_Z = 25.0           # 2020 cross bar centre height
BAR_Y = -24.0          # bar centre (front face y=-34, rear face y=-14)

# --- joints ---
SWIVEL_Y = -56.0                 # vertical swivel axis
PIV_Y, PIV_Z = -88.0, 95.0       # tilt axis (along X)
ARM_T = 10.0                     # swivel arm beam thickness

# --- cradle (local frame) ---
PT = 2.0               # aluminium plate thickness
BUMP = 3.5             # rubber bumpers: iPad back plane at y=-BUMP
PLATE_W, PLATE_Z0, PLATE_Z1 = 214.0, -13.0, 140.0
HUB_Y, HUB_Z = 31.0, 60.0        # tilt axis in local frame
YC, ZC = PIV_Y - HUB_Y, PIV_Z - HUB_Z
RAIL_Z0, RAIL_Z1 = 100.0, 158.0
PITCH, DEPTH, HOOK = 2.0, 1.2, 0.32   # ratchet teeth (15 deg hooked face)
TIP_Y = 13.0                          # rail tooth tips
# iPad Air 11 (Apple spec 247.6 x 178.5 x 6.1)
IPAD_W, IPAD_H, IPAD_T = 247.6, 178.5, 6.1
IPAD_Z0 = 2.1                         # bare iPad rests 2.1 mm up the 45 deg wedge
TOOTH_K = 17
TOOTH_Z = RAIL_Z1 - 2 - PITCH * TOOTH_K   # groove the pawl sits in
ZJ = TOOTH_Z + 60                          # top-jaw wedge apex (built pose)


def bx(x0, x1, y0, y1, z0, z1):
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    z0, z1 = sorted((z0, z1))
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cyl(axis, r, p0, length):
    c = cq.Workplane("XY").circle(r).extrude(length)
    if axis == "x":
        c = c.rotate((0, 0, 0), (0, 1, 0), 90)
    elif axis == "y":
        c = c.rotate((0, 0, 0), (1, 0, 0), -90)
    return c.translate(p0)


def yz_prism(pts, x0, x1):
    return cq.Workplane("YZ").polyline(pts).close().extrude(x1 - x0).translate((x0, 0, 0))


def soft(shape, sel, r):
    try:
        return shape.edges(sel).fillet(r)
    except Exception:
        return shape


def G(shape):
    return shape.translate((0, YC, ZC))


def gl(x, y, z):
    return (x, YC + y, ZC + z)


# ---------------------------------------------------------------- headrest end
def post_clamp_halves(x0):
    bore = cyl("z", BORE / 2, (x0, 0, BAR_Z - 20), 40)
    holes = None
    for dx in (-14, 14):
        h = cyl("y", 2.75, (x0 + dx, -20, BAR_Z), 40)
        holes = h if holes is None else holes.union(h)
    block = soft(bx(x0 - 20, x0 + 20, -14, -0.5, BAR_Z - 12, BAR_Z + 12), "|Z", 3)
    cap = soft(bx(x0 - 20, x0 + 20, 0.5, 11, BAR_Z - 12, BAR_Z + 12), "|Z", 4)
    block = soft(block.cut(bore).cut(holes), ">Z or <Z", 1)
    cap = soft(cap.cut(bore).cut(holes), ">Z or <Z", 1)
    return block, cap


def arm_mount():
    plate = bx(-25, 25, -40, -34, BAR_Z - 10, BAR_Z + 10)
    shelf = bx(-13, 13, -56, -35, BAR_Z - 10, BAR_Z).union(
        cyl("z", 13, (0, SWIVEL_Y, BAR_Z - 10), 10))
    gus = yz_prism([(-34.5, BAR_Z - 10), (-50, BAR_Z - 10), (-34.5, BAR_Z + 8)], -4, 4)
    m = soft(plate, "|Y", 4).union(shelf).union(gus)
    m = m.cut(cyl("z", 3.2, (0, SWIVEL_Y, BAR_Z - 20), 40))
    for x in (-19, 19):
        m = m.cut(cyl("y", 2.75, (x, -45, BAR_Z), 20))
    return m


def swivel_arm():
    boss = cyl("z", 12, (0, SWIVEL_Y, BAR_Z), ARM_T)
    beam = bx(-12, 8, SWIVEL_Y, PIV_Y - 9, BAR_Z, BAR_Z + ARM_T)
    col = soft(bx(-12, 0, PIV_Y - 9, PIV_Y + 9, BAR_Z, PIV_Z), "|Z", 4)
    col = col.cut(bx(-8, -4, PIV_Y - 5, PIV_Y + 5, BAR_Z + ARM_T + 4, PIV_Z - 22))  # lightening slot
    disk = cyl("x", 18, (-12, PIV_Y, PIV_Z), 12)
    a = boss.union(soft(beam, "|Z", 4)).union(col).union(disk)
    a = a.cut(cyl("z", 3.2, (0, SWIVEL_Y, BAR_Z - 5), 30))
    a = a.cut(cyl("x", 3.3, (-20, PIV_Y, PIV_Z), 30))
    # serrated face (24 x 15 deg) that locks the tilt
    a = a.union(serrations().translate((0, PIV_Y, PIV_Z)))
    return a


def serrations():
    ring = None
    for i in range(24):
        t = (cq.Workplane("XY").box(1.5, 1.6, 9).translate((0.25, 0, 12.5))
             .rotate((0, 0, 0), (1, 0, 0), i * 15))
        ring = t if ring is None else ring.union(t)
    return ring


# ------------------------------------------------------------------ cradle
def cradle_plate():
    p = soft(bx(-PLATE_W / 2, PLATE_W / 2, 0, PT, PLATE_Z0, PLATE_Z1), "|Y", 12)
    for s in (-1, 1):
        w = soft(bx(min(s * 32, s * 88), max(s * 32, s * 88), -1, PT + 1, 18, 118), "|Y", 10)
        p = p.cut(w)
    for x, z in HUB_SCREWS + RAIL_SCREWS + HOOK_SCREWS:
        p = p.cut(cyl("y", 1.7, (x, -1, z), PT + 2))
    return p


HUB_SCREWS = [(-14, 46), (14, 46), (-14, 74), (14, 74)]
RAIL_SCREWS = [(0, 110), (0, 132)]
HOOK_SCREWS = [(-75, -7), (-55, -7), (55, -7), (75, -7)]   # hooks centred at x = +-65
BUMPERS = [(-99, 22), (99, 22), (-99, 128), (99, 128)]

# 45 deg wedge channel: holds 6-16 mm thick iPads / cases with no play
LEDGE_PTS = [(0, 8), (-BUMP, 8), (-BUMP, 0), (-BUMP - 4, 0), (-BUMP - 18, 14),
             (-BUMP - 22, 14), (-BUMP - 22, 10), (-BUMP - 8.5, -3.5), (-BUMP - 6.5, -12), (0, -12)]


def bottom_hook(xc):
    h = yz_prism(LEDGE_PTS, xc - 17, xc + 17)
    h = soft(h, "|X", 1.2)
    for x, z in HOOK_SCREWS:
        if abs(x - xc) < 25:
            h = h.cut(cyl("y", 1.25, (x, -8, z), 8.5))
    try:
        h = h.faces("<X or >X").edges().fillet(1.0)
    except Exception:
        pass
    return h


def tilt_hub():
    fl = soft(bx(-21, 21, PT - 0.01, 7, HUB_Z - 21, HUB_Z + 21), "|Y", 6)
    for x, z in HUB_SCREWS:
        fl = fl.union(cyl("y", 4.5, (x, 6, z), 6))
    ear = bx(0, 9, 6, HUB_Y, HUB_Z - 14, HUB_Z + 14).union(cyl("x", 17, (0, HUB_Y, HUB_Z), 9))
    h = fl.union(soft(ear, "|X", 3))
    for x, z in HUB_SCREWS:
        h = h.cut(cyl("y", 1.25, (x, PT - 1, z), 10.5))
    h = h.cut(cyl("x", 3.3, (-5, HUB_Y, HUB_Z), 20))
    hexp = (cq.Workplane("YZ").polygon(6, 11.8).extrude(5.6)
            .translate((3.6, HUB_Y, HUB_Z)))
    h = h.cut(hexp)
    h = h.cut(serrations().translate((0, HUB_Y, HUB_Z)))
    return h


def rail():
    pts = [(5, RAIL_Z1), (TIP_Y - 1.5, RAIL_Z1), (TIP_Y, RAIL_Z1 - 1.5)]
    z = RAIL_Z1 - 2
    while z > RAIL_Z0 + 3:
        pts += [(TIP_Y, z), (TIP_Y - DEPTH, z + HOOK), (TIP_Y, z - PITCH)]
        z -= PITCH
    pts += [(TIP_Y, RAIL_Z0), (5, RAIL_Z0)]
    # drop consecutive duplicates
    clean = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    head = yz_prism(clean, -9, 9)
    base = bx(-5, 5, PT, 5.5, RAIL_Z0, RAIL_Z1)
    r = head.union(base)
    for x, zz in RAIL_SCREWS:
        r = r.cut(cyl("y", 1.25, (x, PT - 1, zz), 10))
    return r


def top_jaw():
    zj = ZJ
    pts = [(-BUMP, 0), (-BUMP - 4, 0), (-BUMP - 18, -14), (-BUMP - 22, -14), (-BUMP - 22, -10),
           (-BUMP - 9, 3), (-BUMP - 7, 5), (16, 5), (16, 0), (1.7, 0), (1.7, -14), (-BUMP, -14)]
    jaw = yz_prism([(y, z + zj) for y, z in pts], -27, 27)
    jaw = soft(jaw, "|X", 1.2)
    try:
        jaw = jaw.faces("<X or >X").edges().fillet(1.0)
    except Exception:
        pass
    stem = bx(-12, 12, 2.3, 16, zj - 70, zj + 5)
    stem = stem.cut(bx(-9.3, 9.3, 4.7, 13.3, zj - 80, zj - 16))
    stem = stem.cut(bx(-5.3, 5.3, 2.0, 5.0, zj - 80, zj - 16))
    stem = stem.cut(bx(-9.3, 9.3, 4.7, 13.3, zj - 14, zj - 2))   # lighten the solid top
    stem = soft(stem, "|Z", 1.5)
    # pivot ears for the release lever
    for s in (-1, 1):
        ear = bx(min(s * 4.3, s * 8.3), max(s * 4.3, s * 8.3), 15, 23, zj - 41, zj - 29).union(
            cyl("x", 6, (min(s * 4.3, s * 8.3), 23, zj - 35), 4))
        stem = stem.union(ear)
    # window for the pawl tooth
    stem = stem.cut(bx(-4.6, 4.6, 13.0, 18.0, TOOTH_Z - 4.5, TOOTH_Z + 2.5))
    j = jaw.union(stem)
    j = j.cut(cyl("x", 1.7, (4, 23, zj - 35), 5))       # clearance side (+X)
    j = j.cut(cyl("x", 1.25, (-9, 23, zj - 35), 5))     # pilot side (-X)
    return j


def release_lever():
    zj = ZJ
    zt = TOOTH_Z
    bar = bx(-4, 4, 21, 25, zt - 4, zj + 12)
    tab = soft(bx(-11, 11, 20.5, 27, zj + 10, zj + 18), "|Y", 3)
    tooth = yz_prism([(22, zt), (TIP_Y + 0.3, zt), (TIP_Y - DEPTH + 0.3, zt + HOOK),
                      (TIP_Y + 0.3, zt - PITCH), (22, zt - PITCH)], -4, 4)
    leaf = yz_prism([(22, zj - 10), (20.4, zj - 10), (16.2, zj - 24), (17.8, zj - 24)], -4, 4)
    lv = bar.union(tab).union(tooth).union(leaf)
    lv = lv.cut(cyl("x", 1.7, (-6, 23, zj - 35), 12))
    return lv


def parts():
    out = []
    # 2020 cross bar + post clamps
    bar = fab.extrusion(200, profile="2020", axis="x", at=(-100, BAR_Y, BAR_Z))
    out.append({"name": "Cross bar 2020 x 200", "shape": bar, "process": "extrusion",
                "params": {"profile": "2020", "length_mm": 200, "tapped_ends": 0}})
    caps = None
    for s in (-1, 1):
        c = soft(bx(min(s * 100, s * 103), max(s * 100, s * 103), BAR_Y - 10, BAR_Y + 10,
                    BAR_Z - 10, BAR_Z + 10), "|X", 2)
        caps = c if caps is None else caps.union(c)
    out.append({"name": "2020 end cap", "shape": caps, "group": "component", "color": "#1a1a1a"})
    side = {-1: "L", 1: "R"}
    for s in (-1, 1):
        x0 = s * POST_SPACING / 2
        blk, cap = post_clamp_halves(x0)
        out.append({"name": f"Post clamp {side[s]}", "shape": blk, "group": "case",
                    "color": "#2b2b2b", "explode": [0, -1, 0]})
        out.append({"name": f"Post clamp cap {side[s]}", "shape": cap, "group": "case",
                    "color": "#2b2b2b", "explode": [0, 1, 0]})
    xs = [s * POST_SPACING / 2 + d for s in (-1, 1) for d in (-14, 14)]
    out.append(part("m5x30_bhcs", at=[(x, 11, BAR_Z) for x in xs], rot=(-90, 0, 0)))
    tn = None
    for x in xs + [-19, 19]:
        y = -16 if x not in (-19, 19) else -32
        t = bx(x - 5, x + 5, y - 2, y + 2, BAR_Z - 3, BAR_Z + 3)
        tn = t if tn is None else tn.union(t)
    out.append({"name": "M5 drop-in T-nut", "shape": tn, "group": "component", "color": "#b0b0b0"})

    # swivel
    out.append({"name": "Arm mount", "shape": arm_mount(), "color": "#2b2b2b"})
    out.append(part("m5x10_bhcs", at=[(-19, -40, BAR_Z), (19, -40, BAR_Z)], rot=(90, 0, 0)))
    out.append({"name": "Swivel arm", "shape": swivel_arm(), "color": "#2b2b2b"})
    out.append(part("m6x35_shcs", at=(0, SWIVEL_Y, BAR_Z - 10), rot=(180, 0, 0)))
    out.append(part("m6_washer", at=(0, SWIVEL_Y, BAR_Z + ARM_T)))
    out.append(part("m6_nylock", at=(0, SWIVEL_Y, BAR_Z + ARM_T + 1.6)))
    knob = cyl("x", 3, (-12.5, PIV_Y, PIV_Z), 23.5).union(
        soft(cyl("x", 13, (-24, PIV_Y, PIV_Z), 12), "%CIRCLE", 3))
    for i in range(5):
        a = math.radians(i * 72 + 90)
        knob = knob.union(cyl("x", 5, (-23.5, PIV_Y + 13 * math.cos(a), PIV_Z + 13 * math.sin(a)), 10))
    out.append({"name": "M6 star knob (male, 25 mm)", "shape": knob, "group": "component",
                "color": "#111111", "explode": [-1, 0, 0]})

    # cradle
    cradle = []
    cradle.append({"name": "Cradle plate", "shape": G(cradle_plate()), "process": "sheet",
                   "params": {"material": "aluminium 5052", "thickness_mm": PT, "bends": 0},
                   "color": "#c9ccd1"})
    cradle.append({"name": "Bottom hook L", "shape": G(bottom_hook(-65)), "color": "#2b2b2b"})
    cradle.append({"name": "Bottom hook R", "shape": G(bottom_hook(65)), "color": "#2b2b2b"})
    cradle.append({"name": "Tilt hub", "shape": G(tilt_hub()), "color": "#2b2b2b"})
    cradle.append({"name": "Ratchet rail", "shape": G(rail()), "color": "#3a3a3a"})
    cradle.append({"name": "Top jaw", "shape": G(top_jaw()), "color": "#2b2b2b",
                   "explode": [0, 0, 1]})
    cradle.append({"name": "Release lever", "shape": G(release_lever()), "color": "#e0582a",
                   "explode": [0, 1, 0]})
    bumps = None
    for x, z in BUMPERS:
        b = soft(cyl("y", 6.35, (x, -BUMP, z), BUMP), "<Y", 1.5)
        bumps = b if bumps is None else bumps.union(b)
    cradle.append({"name": "Rubber bumper 12.7 mm", "shape": G(bumps), "group": "component",
                   "color": "#151515", "material": "rubber"})
    cradle.append(part("m3x10_selftap", at=[gl(x, 0, z) for x, z in HUB_SCREWS + RAIL_SCREWS],
                       rot=(90, 0, 0)))
    cradle.append(part("m3x10_selftap", at=[gl(x, PT, z) for x, z in HOOK_SCREWS], rot=(-90, 0, 0)))
    cradle.append(part("m3x16_selftap", at=gl(8.3, 23, ZJ - 35), rot=(0, 90, 0)))
    cradle.append(part("m6_nut", at=gl(3.8, HUB_Y, HUB_Z), rot=(0, 90, 0)))
    ipad = soft(bx(-IPAD_W / 2, IPAD_W / 2, -BUMP - IPAD_T, -BUMP, IPAD_Z0, IPAD_Z0 + IPAD_H), "|Y", 12)
    ipad = soft(ipad, "|X or |Z", 2.5)
    cradle.append({"name": "iPad Air 11 (yours)", "shape": G(ipad), "group": "component",
                   "color": "#2e3238", "fx": {"screen": {"text": "Movie time", "fg": "#ffffff",
                                                         "bg": "#1d4f91", "face": "-y"}}})
    for p in cradle:
        p["id"] = p["name"]
        p["_tilt"] = True
    out += cradle

    # car (reference only)
    posts = cyl("z", POST_D / 2, (-POST_SPACING / 2, 0, 0), 90).union(
        cyl("z", POST_D / 2, (POST_SPACING / 2, 0, 0), 90))
    out.append({"name": "RAV4 headrest posts (yours)", "shape": posts, "group": "component",
                "color": "#8a8d91", "material": "steel"})
    hr = soft(bx(-125, 125, -60, 55, BAR_Z + 23, BAR_Z + 243), "|Y", 40)
    hr = soft(hr, "not |Y", 15)
    out.append({"name": "RAV4 front headrest (yours)", "shape": hr, "group": "component",
                "color": "#3b3b3b"})
    return out


def motion():
    ps = parts()
    keys = [[0, 0], [0.3, -10], [0.7, 18], [1, 0]]
    return [{"part": p["id"], "type": "rotate", "axis": [1, 0, 0],
             "pivot": [0, PIV_Y, PIV_Z], "keys": keys}
            for p in ps if p.get("_tilt")]


ASSEMBLY = [["Cradle plate"], ["Bottom hook L", "Bottom hook R", "Tilt hub", "Ratchet rail",
            "Rubber bumper 12.7 mm"], ["Cross bar 2020 x 200", "M5 drop-in T-nut"],
            ["Post clamp L", "Post clamp R"], ["Post clamp cap L", "Post clamp cap R"],
            ["Arm mount"], ["Swivel arm"], ["M6 star knob (male, 25 mm)"],
            ["Top jaw", "Release lever"], ["iPad Air 11 (yours)"]]
