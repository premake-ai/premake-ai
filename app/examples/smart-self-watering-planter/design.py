import math
import cadquery as cq
from cadlib.parts import part, info

SCENE = "desk"

# --- main sizes (mm) ---
R_OUT = 63.0      # body outer radius (126 dia)
WALL = 2.0
FLOOR = 2.4
H = 140.0         # body height
SEAT_Z = 45.0     # grow pot rests here on 3 ribs; reservoir below (~0.45 L)
PY = 93.0         # electronics pod back face (y)
POD_HW = 30.0     # pod half width
COVER_T = 2.4

# standard 4" nursery grow pot (plant stays in it): 102 top x 89 high x 74 bottom
POT_TOP_R, POT_BOT_R, POT_H = 51.0, 37.0, 89.0

TUBE = (18.0, 54.0)   # tube riser x, y in the gap at the back


def pod_prism(hw, pts):
    return cq.Workplane("YZ").polyline(pts).close().extrude(hw, both=True)


def body():
    shell = cq.Workplane("XY").circle(R_OUT).extrude(H)
    pod = pod_prism(POD_HW, [(42, 7), (PY, 58), (PY, H), (42, H)])
    b = shell.union(pod)
    try:
        b = b.edges("|Z and >Y").fillet(2.0)
    except Exception:
        pass
    # reservoir + pot cavity
    b = b.cut(cq.Workplane("XY").workplane(offset=FLOOR).circle(R_OUT - WALL).extrude(H))
    # pod cavity (dry), open at the back for the cover
    cav = pod_prism(POD_HW - WALL, [(40, 7 - 35 + 2.83 + 35 - 2), (PY + 5, PY + 5 - 32.17),
                                    (PY + 5, H - WALL), (40, H - WALL)])
    cav = cav.cut(cq.Workplane("XY").circle(R_OUT).extrude(H))
    b = b.cut(cav)

    # pot seat ribs (also stiffen the floor)
    for a in (30, 150, 270):
        rib = (cq.Workplane("XY").box(35, 2.4, SEAT_Z - FLOOR + 1, centered=(False, True, False))
               .translate((26, 0, FLOOR - 1)).rotate((0, 0, 0), (0, 0, 1), a))
        b = b.union(rib)

    # cover screw bosses: lower columns on the sloped floor, upper 45-deg wedges
    prism = pod_prism(POD_HW, [(42, 7), (PY, 58), (PY, H), (42, H)])
    for s in (-1, 1):
        low = cq.Workplane("XY").box(8, 8, 40, centered=False).translate((20 if s > 0 else -28, PY - 8, 32))
        b = b.union(low.intersect(prism))
        wedge = (cq.Workplane("XZ").polyline([(28 * s, 110), (28 * s, H - 1), (20 * s, H - 1), (20 * s, 118)])
                 .close().extrude(-8).translate((0, PY - 8, 0)))
        b = b.union(wedge)
    for s in (-1, 1):
        for z in (64, 132):
            b = b.cut(cq.Workplane("XZ").center(24 * s, z).circle(2.0).extrude(6.5).translate((0, PY, 0)))

    # tube guide on the inside of the rim (45-deg underside, prints without support)
    guide = (cq.Workplane("YZ").polyline([(R_OUT - 1.5, 124), (R_OUT - 1.5, H), (48, H), (48, H - 3)])
             .close().extrude(6).translate((TUBE[0], 0, 0)))
    b = b.union(guide)
    b = b.cut(cq.Workplane("XY").center(*TUBE).circle(3.9).extrude(30).translate((0, 0, 115)))

    # wire pass-through from the pot gap into the pod (well above water)
    b = b.cut(cq.Workplane("XZ").center(-24, 126).circle(3.5).extrude(-20).translate((0, 50, 0)))
    # top: light-sensor window, button and LED holes
    b = b.cut(cq.Workplane("XY").center(15, 68).circle(4.0).extrude(10).translate((0, 0, H - 5)))
    b = b.cut(cq.Workplane("XY").center(-8.5, 71.5).circle(4.0).extrude(10).translate((0, 0, H - 5)))
    b = b.cut(cq.Workplane("XY").center(-23, 76).circle(2.6).extrude(10).translate((0, 0, H - 5)))
    # right side: USB-C charge port notch and sensor vents
    b = b.cut(cq.Workplane("XY").box(8, 9, 11, centered=False).translate((25, 86.8, 77)))
    for z in (96, 100, 104):
        b = b.cut(cq.Workplane("XY").box(8, 12, 2, centered=False).translate((25, 66, z)))

    try:
        b = b.faces(">Z").edges().fillet(0.8)
    except Exception:
        pass
    try:
        b = b.faces("<Z").edges().chamfer(1.2)
    except Exception:
        pass
    return b


def cover():
    c = cq.Workplane("XZ").center(0, (58 + H) / 2).rect(2 * POD_HW, H - 58).extrude(-COVER_T).translate((0, PY, 0))
    try:
        c = c.edges("|Y").fillet(2.0)
    except Exception:
        pass
    for s in (-1, 1):
        for z in (64, 132):
            c = c.cut(cq.Workplane("XZ").center(24 * s, z).circle(1.7).extrude(-10).translate((0, PY - 1, 0)))
    return c


def grow_pot():
    p = (cq.Workplane("XY").workplane(offset=SEAT_Z).circle(POT_BOT_R)
         .workplane(offset=POT_H).circle(POT_TOP_R).loft())
    p = p.cut(cq.Workplane("XY").workplane(offset=SEAT_Z + 1.2).circle(POT_BOT_R - 1.2)
              .workplane(offset=POT_H).circle(POT_TOP_R - 1.2).loft())
    lip = (cq.Workplane("XY").workplane(offset=SEAT_Z + POT_H - 5).circle(POT_TOP_R + 1.5)
           .circle(POT_TOP_R - 0.5).extrude(5))
    return p.union(lip)


def soil():
    z = SEAT_Z + POT_H - 12
    r = POT_BOT_R + (POT_TOP_R - POT_BOT_R) * (POT_H - 12) / POT_H - 1.5
    return cq.Workplane("XY").workplane(offset=z).circle(r).extrude(3)


def _rot(p, rx, ry, rz):
    x, y, z = p
    c, s = math.cos(math.radians(rx)), math.sin(math.radians(rx))
    y, z = y * c - z * s, y * s + z * c
    c, s = math.cos(math.radians(ry)), math.sin(math.radians(ry))
    x, z = x * c + z * s, -x * s + z * c
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    x, y = x * c - y * s, x * s + y * c
    return (x, y, z)


def put(key, centre, rot=(0, 0, 0), top=None):
    """Place a library part so its rotated bbox centre is at `centre` (or its top at `top`)."""
    i = info(key)
    lo, hi = i["bbox_min"], i["bbox_max"]
    pts = [_rot((a, b, c), *rot) for a in (lo[0], hi[0]) for b in (lo[1], hi[1]) for c in (lo[2], hi[2])]
    mn = [min(p[k] for p in pts) for k in range(3)]
    mx = [max(p[k] for p in pts) for k in range(3)]
    at = [centre[k] - (mn[k] + mx[k]) / 2 for k in range(3)]
    if top is not None:
        at[2] = top - mx[2]
    return part(key, at=tuple(at), rot=rot)


def box(cx, cy, cz, sx, sy, sz):
    return cq.Workplane("XY").box(sx, sy, sz).translate((cx, cy, cz))


def tube():
    pts = [(15, 38, 32), (TUBE[0], TUBE[1], 46), (TUBE[0], TUBE[1], H + 6), (TUBE[0], 40, H - 4)]
    t = None
    for a, b in zip(pts, pts[1:]):
        v = cq.Vector(*b) - cq.Vector(*a)
        cyl = cq.Solid.makeCylinder(3.5, v.Length, cq.Vector(*a), v.normalized())
        t = cyl if t is None else t.fuse(cyl)
    return cq.Workplane("XY").add(t)


def parts():
    return [
        {"name": "Planter body", "shape": body(), "color": "#e9e5dc"},
        {"name": "Back cover", "shape": cover(), "color": "#e9e5dc", "explode": [0, 1, 0]},
        {"name": "Grow pot (yours)", "shape": grow_pot(), "group": "component", "color": "#3a3a3a",
         "explode": [0, 0, 1]},
        {"name": "Soil (yours)", "shape": soil(), "group": "component", "color": "#4a3526", "explode": [0, 0, 1]},
        # electronics
        # holder body 77 long, stood upright: y 64..79, z 47..124 (its leads end inside the top wall)
        part("holder_18650", at=(-8.5, 64, 85.5), rot=(0, 90, 90)),
        part("cell_18650", at=(-8.5, 65.2, 85.5), rot=(0, 90, 90)),
        put("tact_12x12", (13, 82, 0), top=H + 0.5),
        put("led_5mm", (-23, 76, 0), top=H + 1.5),
        put("esp32_c3_supermini", (11.25, PY - 2.5, 102), rot=(90, 0, 0)),
        put("m3x8_bhcs", (0, 0, 0), rot=(-90, 0, 0)) if False else
        part("m3x8_bhcs", at=[(24 * s, PY + COVER_T, z) for s in (-1, 1) for z in (64, 132)], rot=(-90, 0, 0)),
        {"name": "TP4056 USB-C charger", "shape": box(14, PY - 2, 82.5, 28, 4, 17), "group": "component",
         "color": "#1f4fa0", "cable": {"type": "usb-c", "at": [POD_HW, PY - 3.2, 82.5], "dir": [1, 0, 0],
                                       "length_mm": 400}},
        {"name": "D4184 MOSFET module", "shape": box(-10.5, PY - 5, 77, 17, 10, 34), "group": "component",
         "color": "#1f4fa0"},
        {"name": "BH1750 light sensor", "shape": box(15, 68, H - WALL - 1.6, 18.5, 13.9, 3.2), "group": "component",
         "color": "#1f4fa0"},
        {"name": "BME280 sensor", "shape": box(26.5, 72, 102, 3, 12, 15), "group": "component", "color": "#6a2a8a"},
        {"name": "Capacitive soil sensor", "shape": box(-22, 12, SEAT_Z + 62, 23, 4, 98), "group": "component",
         "color": "#111111", "explode": [0, 0, 1]},
        {"name": "Mini submersible pump", "shape": box(0, 38, FLOOR + 15, 45, 24, 30), "group": "component",
         "color": "#202020"},
        {"name": "Silicone tube", "shape": tube(), "group": "component", "color": "#d8eef5"},
        put("m3_insert", (-24, PY - 3, 64), rot=(90, 0, 0)),
        put("m3_insert", (24, PY - 3, 64), rot=(90, 0, 0)),
        put("m3_insert", (-24, PY - 3, 132), rot=(90, 0, 0)),
        put("m3_insert", (24, PY - 3, 132), rot=(90, 0, 0)),
    ]
