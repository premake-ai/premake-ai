import math
import cadquery as cq
from cadlib.parts import part
from cadlib.refmodels import ref

# Snap-on magnetic grip + flip-out stand.
# Stack (Z up, phone on top): Flip leaf (2 mm Al) z0-2 | Base plate (2 mm Al) z5-7 |
# Magnet carrier (PETG) z7-11.5 with the magnet ring flush in its top groove.
# Hinge axis runs along X at the +Y edge; an M3 bolt + nylock squeezes the three
# knuckles so the leaf holds any angle 0-180 deg (friction hinge, adjustable).
# 360 deg rotation comes from the round magnet ring turning on the phone's ring.

SCENE = "desk"

R = 31.0                 # body radius (62 mm puck)
T_AL = 2.0               # aluminium plate thickness
AX_Y, AX_Z = 34.5, 3.5   # hinge axis (along X)
KR = 3.2                 # knuckle radius
MID = 4.75               # middle knuckle half-width (leaf side)
GAP = 0.5                # knuckle side clearance
OUT = 13.0              # outer knuckle end |x|
TOP = 11.5               # carrier top = phone contact
# DIY accessory-side MagSafe ring: ~54 OD / 46 ID x 3 mm (listing), groove 1 mm oversize, glued
RING_OD, RING_ID, RING_T = 54.0, 46.0, 3.0
STICKER_T = 0.55         # steel ring sticker for non-MagSafe phones (56/46/0.55)
SCREW_R = 17.0           # base-plate screw circle
LEAF_SCREWS = [(0, 24.5), (0, 30.0)]


def disc(r, z0, h):
    return cq.Workplane("XY").circle(r).extrude(h).translate((0, 0, z0))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def knuckle(x0, x1, r=KR):
    return (cq.Workplane("YZ").circle(r).extrude(x1 - x0)
            .translate((x0, AX_Y, AX_Z)))


def bolt_hole(x0=-30, x1=30):
    return knuckle(x0, x1, 1.7)


def fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def csk_holes(wp, pts, z_face):
    # countersunk M2 holes from the bottom face (SendCutSend countersink option)
    for (x, y) in pts:
        wp = wp.cut(cq.Workplane("XY").circle(1.2).extrude(10).translate((x, y, z_face - 1)))
        wp = wp.cut(cq.Solid.makeCone(2.2, 1.0, 1.2, cq.Vector(x, y, z_face - 0.01)))
    return wp


SCREW_PTS = [(SCREW_R * math.cos(math.radians(a)), SCREW_R * math.sin(math.radians(a)))
             for a in (45, 135, 225, 315)]


def parts():
    # ---- Flip leaf: aluminium ring (finger loop / kickstand) with a neck to the hinge
    leaf = disc(R, 0, T_AL).cut(disc(18, -1, 4))
    leaf = leaf.union(box(-MID, MID, 20, 32.5, 0, T_AL))
    leaf = csk_holes(leaf, LEAF_SCREWS, 0)

    # ---- Leaf knuckle (PETG): pad on the leaf neck + middle knuckle
    lk = box(-MID, MID, 21, AX_Y, T_AL, 4.5).union(knuckle(-MID, MID))
    lk = lk.union(box(-MID, MID, 21, AX_Y, T_AL, AX_Z))
    lk = lk.cut(bolt_hole())
    for (x, y) in LEAF_SCREWS:
        lk = lk.cut(cq.Workplane("XY").circle(0.8).extrude(2.3).translate((x, y, T_AL - 0.1)))
    lk = fillet(lk, "|Y", 0.8)

    # ---- Base plate: aluminium disc, screwed up into the carrier
    base = disc(R, 5, T_AL)
    base = csk_holes(base, SCREW_PTS, 5)

    # ---- Magnet carrier (PETG): disc + hinge tab + two outer knuckles, one solid
    carrier = disc(R, 7, TOP - 7)
    carrier = carrier.union(box(-OUT, OUT, 24, AX_Y + KR, 7, TOP))
    for s in (-1, 1):
        x0, x1 = sorted((s * (MID + GAP), s * OUT))
        carrier = carrier.union(box(x0, x1, R + 0.3, AX_Y + KR, AX_Z, 7.5))
        carrier = carrier.union(knuckle(x0, x1))
    carrier = carrier.cut(bolt_hole())
    # magnet groove, flush top
    carrier = carrier.cut(disc((RING_OD + 1) / 2, TOP - RING_T - 0.2, 5)
                          .cut(disc((RING_ID - 1) / 2, TOP - 6, 8)))
    for (x, y) in SCREW_PTS:
        carrier = carrier.cut(cq.Workplane("XY").circle(0.8).extrude(3.5).translate((x, y, 7)))
    carrier = fillet(carrier, ">Z", 0.8)

    magnet = disc(RING_OD / 2, TOP - RING_T, RING_T).cut(disc(RING_ID / 2, 0, 20))
    sticker = disc(28, TOP, STICKER_T).cut(disc(23, 0, 20))

    out = [
        {"name": "Flip leaf", "id": "leaf", "shape": leaf, "group": "case", "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": 2, "bends": 0},
         "explode": [0, 0, -1]},
        {"name": "Leaf knuckle", "id": "leaf_knuckle", "shape": lk, "group": "case",
         "color": "#2b2b2e", "explode": [0, 0, -1]},
        {"name": "Base plate", "shape": base, "group": "case", "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": 2, "bends": 0}},
        {"name": "Magnet carrier", "shape": carrier, "group": "case", "color": "#2b2b2e",
         "explode": [0, 0, 1]},
        {"name": "MagSafe magnet ring", "shape": magnet, "group": "component",
         "color": "#9a9a9a", "explode": [0, 0, 1]},
        {"name": "Steel ring sticker", "shape": sticker, "group": "component",
         "color": "#c8c8c8", "explode": [0, 0, 1]},
        part("m3x30_bhcs", at=(-OUT, AX_Y, AX_Z), rot=(0, -90, 0)),
        part("m3_washer", at=(OUT, AX_Y, AX_Z), rot=(0, 90, 0)),
        part("m3_nylock", at=(OUT + 0.5, AX_Y, AX_Z), rot=(0, 90, 0)),
        part("m2x5_csk",at=[(x, y, 5) for (x, y) in SCREW_PTS], rot=(180, 0, 0)),
        {**part("m2x4_csk", at=[(x, y, 0) for (x, y) in LEAF_SCREWS], rot=(180, 0, 0)),
         "id": "leaf_screws"},
        ref("android_phone", at=(0, -73.45, TOP + STICKER_T + 4.2), rot=(-90, 0, 0)),
    ]
    return out


ASSEMBLY = [["Magnet carrier"], ["MagSafe magnet ring"], ["Base plate"],
            ["Flip leaf", "Leaf knuckle"], ["Steel ring sticker"]]


def motion():
    leaf_parts = ["leaf", "leaf_knuckle", "leaf_screws"]
    return [{"part": p, "type": "rotate", "axis": [1, 0, 0], "pivot": [0, AX_Y, AX_Z],
             "keys": [[0, 0], [0.3, 70], [0.5, 70], [0.8, 180], [1, 0]]} for p in leaf_parts]
