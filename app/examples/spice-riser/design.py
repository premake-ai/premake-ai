"""Three-tier spice riser for 12 standard 4 oz jars. Hollow stepped shell with ribs.

Z up, mm, front (lowest tier) faces -Y. Prints upright, steps are 45-deg-free (all vertical
risers and flat treads bridged by ribs every ~80 mm).
"""
import cadquery as cq

W = 240.0
TIER_D = 52.0
RISE = 26.0
T = 2.0
LIP = 7.0
JAR_D, JAR_H = 47.0, 98.0
JARS_PER_ROW = 4


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def tread_z(i):
    return T + i * RISE


def make_riser():
    D = 3 * TIER_D
    y0 = -D / 2
    body = None
    for i in range(3):
        ya, yb = y0 + i * TIER_D, y0 + (i + 1) * TIER_D
        z = tread_z(i)
        tread = box(-W / 2, W / 2, ya, D / 2, z - T, z)
        riser = box(-W / 2, W / 2, ya, ya + T, 0 if i == 0 else z - RISE, z + LIP)
        part = tread.union(riser)
        body = part if body is None else body.union(part)
    back = box(-W / 2, W / 2, D / 2 - T, D / 2, 0, tread_z(2) + 18)
    body = body.union(back)
    # side walls + 2 internal ribs (full step profile)
    prof = [(y0, 0), (y0, tread_z(0) + LIP)]
    for i in range(3):
        ya = y0 + i * TIER_D
        prof += [(ya + T, tread_z(i) + LIP), (ya + T, tread_z(i))] if False else []
    prof = [(y0, 0), (D / 2, 0), (D / 2, tread_z(2) + 18), (y0 + 2 * TIER_D, tread_z(2) + LIP),
            (y0 + 2 * TIER_D, tread_z(1)), (y0 + TIER_D, tread_z(1)), (y0 + TIER_D, tread_z(0)), (y0, tread_z(0))]
    for x in (-W / 2, -T / 2, W / 2 - T):
        rib = cq.Workplane("YZ").polyline(prof).close().extrude(T).translate((x, 0, 0))
        body = body.union(rib)
    try:
        body = body.edges("|Y and (<X or >X)").fillet(1.0)
    except Exception:
        pass
    # soften the tread lips
    try:
        body = body.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    return body


def jar(x, y, z):
    glass = cq.Workplane("XY").circle(JAR_D / 2).extrude(JAR_H - 22).edges("<Z").fillet(4).translate((x, y, z))
    lid = cq.Workplane("XY").circle(JAR_D / 2 - 1.5).extrude(18).edges(">Z").fillet(2).translate((x, y, z + JAR_H - 22))
    return glass, lid


def make_jars():
    D = 3 * TIER_D
    glass_all, lids = None, None
    pitch = (W - 8) / JARS_PER_ROW
    for i in range(3):
        y = -D / 2 + i * TIER_D + TIER_D / 2 + 1.0
        for j in range(JARS_PER_ROW):
            x = -W / 2 + 4 + pitch * (j + 0.5)
            g, l = jar(x, y, tread_z(i) + 0.2)
            glass_all = g if glass_all is None else glass_all.union(g)
            lids = l if lids is None else lids.union(l)
    return glass_all, lids


def parts():
    g, l = make_jars()
    return [
        {"name": "Spice riser", "shape": make_riser(), "group": "case", "color": "#e9e4d8", "explode": [0, 0, -1]},
        {"name": "4 oz glass spice jars (12x)", "shape": g, "group": "component", "color": "#cfe8ef", "explode": [0, 0, 1]},
        {"name": "Jar shaker lids (12x)", "shape": l, "group": "component", "color": "#2b2d42", "explode": [0, 0, 1.4]},
    ]
