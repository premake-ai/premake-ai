import math
import cadquery as cq

# Pot (tapered, prints upright). Soil sits on a perforated platform; water below it.
H = 124            # rim height
RB, RT = 80, 84    # outer radius bottom / top (168 mm across)
FLOOR = 2.0        # 10 solid layers at 0.2 mm
WET_Z = 72         # reservoir zone: thick, watertight walls below this
WALL_WET, WALL_DRY = 2.0, 1.2   # 4 x 0.5 mm perimeters wet, 3 x 0.4 mm dry
RES_TOP = 68       # platform underside; max water level 63 (5 mm air gap)
WATER_MAX = 63
PLAT_T = 1.6

# Gauge + fill tower at the front: pour water in the top, cork float inside
IND_BORE = 16.0                 # 32 mm bore: 24 mm cork + room for water to pass
IND_R = IND_BORE + 1.2          # inner tube: water on both sides, no seal needed
IND_Y = -(RB - WALL_WET - IND_R)   # tube touches the inner wall at the floor
BLOCK_W = 44                    # gauge block width (x)

# Float: natural wine cork + printed rod with a red marker disc
CORK_D, CORK_H = 24, 44
DRAFT = 19                      # cork + rod (~8.5 g) floats ~19 mm deep
LIFT_FULL = WATER_MAX - FLOOR - DRAFT   # ~42 mm of marker travel
LIFT = 24                       # built pose
MARK0 = H + 8                   # marker centre when the cork sits on the floor (REFILL)
MARK_T = 3
GAUGE_H = 8 + LIFT_FULL + 10    # block height above the rim


def r_at(z):
    return RB + (RT - RB) * z / H


def revolve(pts):
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def cyl(x, y, r, z0, z1):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(r).extrude(z1 - z0)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def label(text, x, z, face_y, x_max):
    """Engraving tool for text, shrunk until it fits left of x_max."""
    for size in (3.6, 3.2, 2.8, 2.5):
        try:
            t = (cq.Workplane("XZ", origin=(0, face_y + 0.6, 0)).center(x, z)
                 .text(text, size, 2, halign="left", valign="bottom", kind="bold"))
        except Exception:
            return None
        if t.val().BoundingBox().xmax <= x_max:
            return t
    return t


def pot():
    outer = revolve([(0, 0), (RB, 0), (RT, H), (0, H)])
    try:
        outer = outer.faces("<Z").edges().fillet(6)
    except Exception:
        pass
    rw = r_at(WET_Z)
    inner = revolve([(0, FLOOR), (RB - WALL_WET, FLOOR), (rw - WALL_WET, WET_Z),
                     (rw - WALL_DRY, WET_Z + 0.8), (RT - WALL_DRY, H + 1), (0, H + 1)])
    body = outer.cut(inner)
    try:
        body = body.faces(">Z").edges().fillet(0.6)
    except Exception:
        pass
    # gauge / fill tube + web to the wall, and the gauge block above the rim
    body = body.union(cyl(0, IND_Y, IND_R, FLOOR - 1, H + GAUGE_H))
    body = body.union(box(-2, 2, -RT + 1, IND_Y, FLOOR - 1, H))
    pad = box(-BLOCK_W / 2, BLOCK_W / 2, -RT, IND_Y, H - 0.5, H + GAUGE_H)
    try:
        pad = pad.edges("|Z").fillet(4).faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    body = body.union(pad)
    body = body.cut(cyl(0, IND_Y, IND_BORE, FLOOR, H + GAUGE_H + 1))
    # hollow the block: 1.6 mm skin, open towards the back (above the soil)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 4.2, sx * (BLOCK_W / 2 - 1.6)))
        body = body.cut(box(x0, x1, -RT + 1.6, IND_Y + 0.01, H + 1.6, H + GAUGE_H - 2.5))
    # funnel lead-in for pouring
    body = body.cut(cq.Workplane("XY").workplane(offset=H + GAUGE_H - 3).center(0, IND_Y)
                    .circle(IND_BORE).workplane(offset=3.01).circle(IND_BORE + 2.5).loft())
    # notches at the floor so water flows out into the tank
    body = body.cut(box(-IND_R - 1, IND_R + 1, IND_Y - 4, IND_Y + 4, FLOOR, FLOOR + 8))
    body = body.cut(box(-4, 4, IND_Y, IND_Y + IND_R + 1, FLOOR, FLOOR + 8))
    # sight window onto the red marker
    body = body.cut(box(-2.5, 2.5, -RT - 1, IND_Y, H + 3, H + GAUGE_H - 4))
    # engraved scale: FULL / HALF / REFILL ticks and labels
    face_y = -RT
    x_max = BLOCK_W / 2 - 5
    marks = cq.Workplane("XY")
    for z, text in ((MARK0 + LIFT_FULL, "FULL"), (MARK0, "REFILL")):
        marks = marks.union(box(-x_max, x_max, face_y - 1, face_y + 0.6, z - 0.5, z + 0.5))
        t = label(text, 4, z + 1.6, face_y, x_max)
        if t is not None:
            marks = marks.union(t)
    zh = MARK0 + LIFT_FULL / 2
    marks = marks.union(box(-8, 8, face_y - 1, face_y + 0.6, zh - 0.4, zh + 0.4))
    try:
        body = body.cut(marks)
    except Exception:
        pass
    return body


def platform():
    rp = r_at(RES_TOP) - WALL_WET - 1.2
    p = cyl(0, 0, rp, RES_TOP, RES_TOP + PLAT_T)
    try:
        p = p.faces(">Z").edges().chamfer(0.8)
    except Exception:
        pass
    # wicking cup down to the floor, with slots
    cup = cyl(0, 0, 22, FLOOR + 0.5, RES_TOP + 0.1).cut(cyl(0, 0, 20.4, FLOOR, RES_TOP + 1))
    for a in range(0, 180, 30):
        cup = cup.cut(box(-24, 24, -1.25, 1.25, FLOOR + 6, RES_TOP - 6)
                      .rotate((0, 0, 0), (0, 0, 1), a))
    p = p.union(cup).cut(cyl(0, 0, 20.4, RES_TOP - 1, RES_TOP + PLAT_T + 1))
    # legs, clear of the front tower
    for a in (30, 150, 270 + 180):
        leg = cyl(55, 0, 3, FLOOR + 0.5, RES_TOP + 0.1).rotate((0, 0, 0), (0, 0, 1), a)
        p = p.union(leg)
    # drainage / air holes
    for ring_r, n in ((31, 12), (45, 18), (62, 24)):
        for i in range(n):
            hole = cyl(ring_r, 0, 2.6, RES_TOP - 1, RES_TOP + PLAT_T + 1).rotate(
                (0, 0, 0), (0, 0, 1), i * 360 / n + 7)
            p = p.cut(hole)
    # clear the front tower
    p = p.cut(cyl(0, IND_Y, IND_R + 1, RES_TOP - 1, RES_TOP + 5))
    p = p.cut(box(-IND_R - 1, IND_R + 1, -RT, IND_Y, RES_TOP - 1, RES_TOP + 5))
    return p


def cork():
    c = cq.Workplane("XY").circle(CORK_D / 2).extrude(CORK_H)
    try:
        c = c.edges().chamfer(1)
    except Exception:
        pass
    return c.translate((0, IND_Y, FLOOR + LIFT))


def rod():
    z0 = FLOOR + CORK_H - 10                    # 10 mm pushed into the cork
    z1 = MARK0 - MARK_T / 2
    r = cq.Workplane("XY").circle(2).extrude(z1 - z0)
    try:
        r = r.faces("<Z").chamfer(0.8)
    except Exception:
        pass
    # marker disc guides the rod; four notches let poured water past it
    disc = cq.Workplane("XY").circle(IND_BORE - 0.8).extrude(MARK_T)
    for a in (45, 135, 225, 315):
        disc = disc.cut(cyl(IND_BORE - 1, 0, 4, -1, MARK_T + 1).rotate((0, 0, 0), (0, 0, 1), a))
    disc = disc.translate((0, 0, z1 - z0))
    return r.union(disc).translate((0, IND_Y, z0 + LIFT))


def parts():
    return [
        {"name": "Pot", "shape": pot(), "group": "case", "color": "#e8e2d6"},
        {"name": "Soil platform", "shape": platform(), "group": "case", "color": "#6f8f6a",
         "explode": [0, 0, 1]},
        {"name": "Gauge rod", "id": "rod", "shape": rod(), "group": "case",
         "color": "#e0452b", "explode": [0, 0, 1]},
        {"name": "Wine cork float", "id": "cork", "shape": cork(), "group": "component",
         "color": "#c49a6c", "explode": [0, 0, 1]},
    ]


def motion():
    keys = [[0, 0], [0.3, LIFT_FULL - LIFT], [0.65, -LIFT], [1, 0]]
    return [{"part": p, "type": "slide", "axis": [0, 0, 1], "keys": keys} for p in ("rod", "cork")]
