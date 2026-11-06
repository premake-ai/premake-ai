import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.motion import rot

# Reference laptop: 13" MacBook Air footprint (apple.com/macbook-air/specs)
LW, LD, LH = 304.1, 215.0, 11.3
LID_T = 5.0          # lid thickness (not published, estimated; clamp takes 0-14 mm)
LID_H = 205.0        # lid height (estimated)
TILT = 12            # lid tilted back from vertical

HOOD_D = 230         # how far the hood reaches in front of the screen
REAR = 26            # top panel overhang behind the lid (over the clamps)
CLR = 2.0            # side panel clearance to the lid edge
T = fab.sheet_actual("plywood", 3)
SLOT = fab.slot_width("plywood", 3)
# Friction (free-stop) hinge, SPEP FH0150SS: 40 long x 35 open, 4.3 holes (M4)
HINGE_Y = (-HOOD_D + 35, -40)    # hinge centres along the top edge
KN = 3.5                         # knuckle radius (not published, estimated)
LEAF = 17.5

BR = 6.0             # clamp bridge thickness
ZT = LID_H + BR      # underside of the top panel
CLAMP_X = (-95, 95)  # clear of the centre camera notch
CW = 24              # clamp width
JAW_Y = 14           # rear jaw inner face (front jaw inner face at y=0)
SIDE_X = LW / 2 + CLR

PLY = {"material": "plywood", "thickness_mm": 3}
INK = "#262626"


def tilt(s):
    """Lid frame (lid upright, screen faces -Y, hinge at origin) -> world."""
    return s.rotate((0, 0, 0), (1, 0, 0), -TILT).translate((0, 0, LH - LID_T))


PX = SIDE_X - KN                # hinge axis (right side; left is mirrored)
PZ = ZT - KN
HOLE_TOP_X = PX - 11             # hinge holes in the top leaf
HOLE_SIDE_Z = PZ - 11            # hinge holes in the side leaf
SIDE_ZB = ZT - 150               # side bottom: folded sides meet with an 8 mm gap


def top_panel():
    w = 2 * (SIDE_X + T)
    p = cq.Workplane("XY").box(w, HOOD_D + REAR, T, centered=(True, False, False)).translate((0, -HOOD_D, ZT))
    p = p.edges("|Z").fillet(12)
    for sx in (-1, 1):
        for hy in HINGE_Y:
            for dy in (-12, 12):
                p = p.cut(cq.Workplane("XY").circle(2.25).extrude(20).translate((sx * HOLE_TOP_X, hy + dy, ZT - 5)))
    for cx in CLAMP_X:
        for dx in (-7, 7):
            p = p.cut(cq.Workplane("XY").circle(1.7).extrude(20).translate((cx + dx, 9.5, ZT - 5)))
    return p


def side_panel(sx):
    # rear edge stops in front of the screen so the folded side clears the lid clamps
    pts = [(-HOOD_D + 6, ZT), (-6, ZT), (-6, SIDE_ZB), (-HOOD_D * 0.55, SIDE_ZB)]
    s = cq.Workplane("YZ").polyline(pts).close().extrude(T)
    try:
        s = s.edges("|X").fillet(8)
    except Exception:
        pass
    for hy in HINGE_Y:
        for dy in (-12, 12):
            s = s.cut(cq.Workplane("YZ").center(hy + dy, HOLE_SIDE_Z).circle(2.25).extrude(10).translate((-3, 0, 0)))
    return s.translate((SIDE_X if sx > 0 else -SIDE_X - T, 0, 0))


def hinge(sx, leaf):
    """Dummy friction hinge: leaf 'top' (+ knuckle) on the top panel, leaf 'side' on the side panel."""
    out = None
    for hy in HINGE_Y:
        if leaf == "top":
            h = cq.Workplane("XY").box(LEAF, 40, 1.5, centered=(False, True, False)).translate((PX - LEAF, hy, ZT - 1.5))
            h = h.union(cq.Workplane("XZ").center(PX, PZ).circle(KN).extrude(20, both=True).translate((0, hy, 0)))
        else:
            h = cq.Workplane("XY").box(1.5, 40, LEAF, centered=(False, True, False)).translate((SIDE_X - 1.5, hy, PZ - LEAF + 0.5))
        out = h if out is None else out.union(h)
    return out if sx > 0 else out.mirror("YZ")


def clamp(cx):
    x0 = cx - CW / 2
    bridge = cq.Workplane("XY").box(CW, JAW_Y + 10 + 3, BR, centered=False).translate((x0, -3, LID_H))
    front = cq.Workplane("XY").box(CW, 3, 6 + BR, centered=False).translate((x0, -3, LID_H - 6))
    rear = cq.Workplane("XY").box(CW, 10, 18 + BR, centered=False).translate((x0, JAW_Y, LID_H - 18))
    c = bridge.union(front).union(rear)
    try:
        c = c.edges("|X").fillet(1.5)
    except Exception:
        pass
    zc = LID_H - 10
    # M4 thumbscrew: clearance hole + nut trap on the outside face
    c = c.cut(cq.Workplane("XZ").center(cx, zc).circle(2.25).extrude(-40).translate((0, -5, 0)))
    c = c.cut(cq.Workplane("XZ").center(cx, zc).polygon(6, 8.1).extrude(-3.6).translate((0, JAW_Y + 10 - 3.6, 0)))
    # 2x M3 into captive nuts from below
    for dx in (-7, 7):
        c = c.cut(cq.Workplane("XY").circle(1.7).extrude(BR + 2).translate((cx + dx, 9.5, LID_H - 1)))
        c = c.cut(cq.Workplane("XY").polygon(6, 6.4).extrude(2.6).translate((cx + dx, 9.5, LID_H - 0.01)))
    return c


def thumbscrew(cx):
    zc = LID_H - 10
    head = cq.Workplane("XZ").center(cx, zc).polygon(12, 14).extrude(-6).translate((0, JAW_Y + 10, 0))
    shank = cq.Workplane("XZ").center(cx, zc).circle(2).extrude(-25).translate((0, JAW_Y + 10 - 25, 0))
    return head.union(shank).translate((0, 0, 0))


def parts():
    base = cq.Workplane("XY").box(LW, LD, LH - LID_T, centered=(True, False, False)).translate((0, -LD, 0))
    base = base.edges("|Z").fillet(8)
    lid = cq.Workplane("XY").box(LW, LID_T, LID_H, centered=(True, False, False)).edges("|Y").fillet(8)
    screen = cq.Workplane("XY").box(LW - 16, 0.5, LID_H - 20, centered=(True, False, False)).translate((0, -0.4, 8))

    out = [
        {"name": "Laptop base (reference)", "shape": base, "group": "component", "color": "#b8bcc2"},
        {"name": "Laptop lid (reference)", "shape": tilt(lid), "group": "component", "color": "#b8bcc2"},
        {"name": "Screen (reference)", "shape": tilt(screen), "group": "component", "color": "#10141c"},
        {"name": "Hood top", "shape": tilt(top_panel()), "group": "case", "process": "laser", "params": PLY,
         "color": INK, "explode": [0, 0, 1]},
    ]
    for sx, s in ((-1, "L"), (1, "R")):
        out += [
            {"name": f"Hood side {s}", "id": f"side_{s}", "shape": tilt(side_panel(sx)), "group": "case",
             "process": "laser", "params": PLY, "color": INK, "explode": [sx, 0, 0]},
            {"name": f"Friction hinges {s} (top leaves)", "shape": tilt(hinge(sx, "top")), "group": "component",
             "color": "#c9c9c9"},
            {"name": f"Friction hinges {s} (side leaves)", "id": f"hleaf_{s}", "shape": tilt(hinge(sx, "side")),
             "group": "component", "color": "#c9c9c9", "explode": [sx, 0, 0]},
        ]
        hp = [(hy + dy) for hy in HINGE_Y for dy in (-12, 12)]
        out.append(lp("m4x10_bhcs", [(sx * HOLE_TOP_X, y, ZT + T) for y in hp], (0, 0, 0)))
        out.append(lp("m4_nut", [(sx * HOLE_TOP_X, y, ZT - 1.5 - 3.2) for y in hp], (0, 0, 0)))
        out.append(lp("m4x10_bhcs", [(sx * (SIDE_X + T), y, HOLE_SIDE_Z) for y in hp], (0, 90 * sx, 0), f"sscrew_{s}"))
        out.append(lp("m4_nut", [(sx * (SIDE_X - 1.5), y, HOLE_SIDE_Z) for y in hp], (0, -90 * sx, 0), f"snut_{s}"))
    for i, cx in enumerate(CLAMP_X):
        out.append({"name": f"Lid clamp {i + 1}", "shape": tilt(clamp(cx)), "group": "case", "color": "#3a3f47",
                    "explode": [0, 1, 0]})
        out.append({"name": f"M4x25 thumb screw {i + 1}", "shape": tilt(thumbscrew(cx)), "group": "component",
                    "color": "#c9c9c9", "explode": [0, 1, 0]})
    pts = [(cx + dx, 9.5) for cx in CLAMP_X for dx in (-7, 7)]
    out.append(part("m3x10_bhcs", at=[world(x, y, ZT + T) for x, y in pts], rot=(-TILT, 0, 0)))
    out.append(part("m3_nut", at=[world(x, y, LID_H) for x, y in pts], rot=(-TILT, 0, 0)))
    return out


def lp(key, at, r, pid=None):
    """Library part placed in the lid frame, then tilted with the lid."""
    d = part(key, at=at, rot=r)
    a = math.radians(-TILT)
    c, s = math.cos(a), math.sin(a)
    m = [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, LH - LID_T], [0, 0, 0, 1]]
    d["shape"] = d["shape"].copy().apply_transform(m)
    if pid:
        d["id"] = pid
    return d


def world(x, y, z):
    a = math.radians(-TILT)
    return (x, y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a) + LH - LID_T)


def motion():
    a = math.radians(-TILT)
    axis = (0, math.cos(a), math.sin(a))

    def pose(t):
        u = min(1.0, max(0.0, (0.5 - abs(t - 0.5)) / 0.35))   # fold, hold, unfold
        ang = 90 * (3 * u * u - 2 * u * u * u)
        out = {}
        for sx, s in ((-1, "L"), (1, "R")):
            tr = rot(axis, sx * ang, world(sx * PX, 0, PZ))
            for pid in (f"side_{s}", f"hleaf_{s}", f"sscrew_{s}", f"snut_{s}"):
                out[pid] = tr
        return out

    return {"duration": 6, "pose": pose}
