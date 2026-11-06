import cadquery as cq
from cadlib.shapes import safe_fillet
from cadlib.parts import part

SCENE = "desk"
ASSEMBLY = [["Body"], ["Lid gasket"], ["Lid"]]

R = 55.0          # body outer radius
H = 75.0          # body height (rim top)
WALL = 2.0        # 5 perimeters, watertight in PETG
RI = R - WALL     # cavity radius
R_OPEN = 39.0     # opening under the lid (ledge inner edge)
R_REC = 48.5      # lid recess radius
LEDGE_Z = H - 5   # ledge top (gasket sits here)
LID_T = 3.0
LID_Z0 = LEDGE_Z + 1.0       # lid bottom, on the 1 mm gasket
LID_Z1 = LID_Z0 + LID_T      # lid top, 1 mm below the rim
SCREW_R = 43.5
SCREWS = [(SCREW_R, 0), (-SCREW_R, 0)]
SLOT = (56.0, 10.0, -15.0)   # fill slot length, width, y offset

TIP = (-105.0, 0.0, 64.5)    # spout tip centre
BASE = (-40.0, 0.0, 32.5)    # spout base centre (inside body)


def spout():
    pb = cq.Plane(origin=BASE, xDir=(0, 1, 0), normal=(-1, 0, 0))
    pt = cq.Plane(origin=TIP, xDir=(0, 1, 0), normal=(-1, 0, 0))
    sp = cq.Workplane("XY").add(cq.Solid.makeLoft(
        [cq.Workplane(pb).rect(32, 79).val(), cq.Workplane(pt).rect(22, 21).val()], True))
    sp = safe_fillet(sp, None, 4, label="spout edges")
    return sp


def spout_channel():
    """Hollow inside of the spout (2.4 mm walls), open into the body cavity; tip wall left solid for the bore."""
    pb = cq.Plane(origin=(BASE[0], 0, BASE[2]), xDir=(0, 1, 0), normal=(-1, 0, 0))
    pt = cq.Plane(origin=(TIP[0] + 5, 0, TIP[2] - 1), xDir=(0, 1, 0), normal=(-1, 0, 0))
    return cq.Workplane("XY").add(cq.Solid.makeLoft(
        [cq.Workplane(pb).rect(27, 68).val(), cq.Workplane(pt).rect(17, 14).val()], True))


def handle():
    outer = cq.Workplane("XZ").polyline([(30, 0), (30, H), (98, H), (106, H - 8), (106, 44), (62, 0)]).close() \
        .extrude(7, both=True)
    outer = safe_fillet(outer, "not |Y", 3, label="handle edges")
    inner = cq.Workplane("XZ").polyline([(40, 18), (40, 63), (88, 63), (94, 57), (94, 40), (72, 18)]).close() \
        .extrude(10, both=True)
    inner = safe_fillet(inner, "|Y", 4, label="handle opening")
    return outer.cut(inner)


def body():
    b = cq.Workplane("XY").circle(R).extrude(H)
    b = safe_fillet(b, ">Z", 4, label="rim")
    b = safe_fillet(b, "<Z", 2, label="base")
    b = b.union(spout()).union(handle())
    b = b.cut(cq.Workplane("XY").box(400, 400, 50, centered=(True, True, False)).translate((0, 0, -50)))
    # cavity: cylinder, 45 deg cone up to the opening (prints without support)
    cone_z0 = LEDGE_Z - (RI - R_OPEN)
    prof = [(0, WALL), (RI, WALL), (RI, cone_z0), (R_OPEN, LEDGE_Z), (R_OPEN, H + 1), (0, H + 1)]
    cav = cq.Workplane("XZ").polyline(prof).close().revolve(360, (0, 0, 0), (0, 1, 0))
    b = b.cut(cav)
    b = b.cut(spout_channel().intersect(cq.Workplane("XY").box(400, 400, 200, centered=(True, True, False))
                                        .translate((0, 0, WALL))))
    # lid recess
    b = b.cut(cq.Workplane("XY").workplane(offset=LEDGE_Z).circle(R_REC).extrude(10))
    # screw bosses under the ledge, merged into the cone wall, pointed bottoms print without support
    for x, y in SCREWS:
        z0 = LEDGE_Z - 11
        p = cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(4).extrude(11) \
            .union(cq.Workplane("XY").add(cq.Solid.makeCone(0.5, 4, 4, pnt=cq.Vector(x, y, z0 - 4))))
        b = b.union(p)
        b = b.cut(cq.Workplane("XY").workplane(offset=LEDGE_Z - 8).center(x, y).circle(1.25).extrude(9))
    # pour bore along the spout axis into the cavity
    d = cq.Vector(BASE) - cq.Vector(TIP)
    bore = cq.Workplane(cq.Plane(origin=cq.Vector(TIP) - d.normalized() * 2, xDir=(0, 1, 0), normal=d)) \
        .circle(5).extrude(d.Length * 0.55)
    b = b.cut(bore)
    return b


def lid():
    rl = R_REC - 0.3
    l = cq.Workplane("XY").workplane(offset=LID_Z0).circle(rl).extrude(LID_T)
    l = safe_fillet(l, ">Z", 1.2, label="lid edge")
    # shallow face recess with a bar left standing across it for the screws
    dish = cq.Workplane("XY").workplane(offset=LID_Z1 - 1.2).circle(rl - 4).extrude(2) \
        .cut(cq.Workplane("XY").workplane(offset=LID_Z1 - 1).rect(2 * rl, 12).extrude(3))
    l = l.cut(dish)
    L, W, sy = SLOT
    l = l.cut(cq.Workplane("XY").workplane(offset=LID_Z0 - 1).center(0, sy).slot2D(L, W).extrude(LID_T + 2))
    for x, y in SCREWS:
        l = l.cut(cq.Workplane("XY").workplane(offset=LID_Z0 - 1).center(x, y).circle(1.7).extrude(LID_T + 2))
    return l


def gasket():
    g = cq.Workplane("XY").workplane(offset=LEDGE_Z).circle(R_REC - 0.5).circle(R_OPEN + 0.5).extrude(1.0)
    for x, y in SCREWS:
        g = g.cut(cq.Workplane("XY").workplane(offset=LEDGE_Z - 1).center(x, y).circle(1.8).extrude(3))
    return g


def parts():
    return [
        {"name": "Body", "shape": body(), "color": "#4a4d50"},
        {"name": "Lid gasket", "shape": gasket(), "color": "#1a1a1a", "material": "rubber", "explode": [0, 0, 1]},
        {"name": "Lid", "shape": lid(), "color": "#5a5e62", "explode": [0, 0, 1]},
        part("m3x10_selftap", at=[(x, y, LID_Z1) for x, y in SCREWS]),
    ]
