import math
import cadquery as cq
from cadlib.parts import part

# Wall-mounted bead-chain blind driver: NEMA17 turns a printed sprocket that
# grips the blind's existing chain loop. ESP32-C3 + TMC2209, 12 V adapter.
W, D, H = 72, 60, 135          # body outside (X, Y, Z); body y -30..30
T = 3                          # wall
PT = 4                         # front plate thickness, y -34..-30
MZ = 108                       # motor / sprocket axis height
FRONT = -D / 2                 # -30
PITCH_R = 15.35                # 16 pockets x 6 mm pitch (4.5 mm beads)
BOSS = [(sx * 28, z) for sx in (-1, 1) for z in (8, 127)]
EAR_W, EAR_T, EAR_Z0, EAR_H = 16, 6, 20, 90   # wall ears beside the body, at the back
EAR_X = W / 2 + EAR_W / 2                      # slot centre x
SLOT_LEN = 60                                  # tension travel (mm)
MOTOR_SCREWS = [(sx * 15.5, MZ + sz * 15.5) for sx in (-1, 1) for sz in (-1, 1)]


def body():
    outer = cq.Workplane("XY").box(W, D, H, centered=(True, True, False))
    try:
        outer = outer.edges("|Y").fillet(8).faces(">Y").edges().fillet(2)
    except Exception:
        pass
    b = outer.faces("<Y").shell(-T)
    # insert bosses, each with a corner web fused into both walls
    for x, z in BOSS:
        sx, sz = (1 if x > 0 else -1), (1 if z > H / 2 else -1)
        cx, cz = (x + sx * W / 2) / 2, (z + (H if sz > 0 else 0)) / 2
        boss = (cq.Workplane("XZ", origin=(0, FRONT + 10, 0)).center(x, z).circle(4.5).extrude(10)
                .union(cq.Workplane("XZ", origin=(0, FRONT + 10, 0)).center(cx, z)
                       .rect(abs(W / 2 - x), 9).extrude(10))
                .union(cq.Workplane("XZ", origin=(0, FRONT + 10, 0)).center(x, cz)
                       .rect(9, abs((H if sz > 0 else 0) - z)).extrude(10)))
        b = b.union(boss.intersect(outer))
        b = b.cut(cq.Workplane("XZ", origin=(0, FRONT + 7, 0)).center(x, z).circle(2.0).extrude(8))
    for x in (-29, 17):                         # perfboard posts
        for y in (-14, 14):
            b = b.union(cq.Workplane("XY").center(x, y).circle(3).extrude(13))
            b = b.cut(cq.Workplane("XY", origin=(0, 0, 6)).center(x, y).circle(1.25).extrude(8))
    # side mounting ears with vertical slots: slide the box down to tension the chain
    for s in (-1, 1):
        ear = (cq.Workplane("XZ", origin=(0, D / 2, 0)).center(s * (W / 2 + EAR_W / 2 - 4), EAR_Z0 + EAR_H / 2)
               .rect(EAR_W + 8, EAR_H).extrude(EAR_T))
        try:
            ear = ear.edges("|Y").fillet(5)
        except Exception:
            pass
        slot = (cq.Workplane("XZ", origin=(0, D / 2 + 1, 0)).center(s * EAR_X, EAR_Z0 + EAR_H / 2)
                .slot2D(SLOT_LEN + 4.5, 4.5, angle=90).extrude(EAR_T + 2))
        b = b.union(ear).cut(slot)
    b = b.cut(cq.Workplane("XY", origin=(0, 0, -1)).center(27, 20).circle(5.6).extrude(5))
    return b


def front_plate():
    p = cq.Workplane("XZ", origin=(0, FRONT, 0)).center(0, H / 2).rect(W, H).extrude(PT)
    try:
        p = p.edges("|Y").fillet(8).faces("<Y").edges().fillet(1.5)
    except Exception:
        pass
    # chain guard: lower half-ring around the sprocket
    ring = (cq.Workplane("XZ", origin=(0, FRONT - PT, 0)).center(0, MZ)
            .circle(24).circle(21).extrude(18))
    ring = ring.cut(cq.Workplane("XY").box(60, 40, 40).translate((0, FRONT - PT - 9, MZ + 20 + 4)))
    p = p.union(ring)
    p = p.cut(cq.Workplane("XZ", origin=(0, FRONT + 1, 0)).center(0, MZ).circle(11.5).extrude(PT + 2))
    for x, z in BOSS + MOTOR_SCREWS:
        p = p.cut(cq.Workplane("XZ", origin=(0, FRONT + 1, 0)).center(x, z).circle(1.7).extrude(PT + 2))
    # status LED window
    p = p.cut(cq.Workplane("XZ", origin=(0, FRONT + 1, 0)).center(0, 40).circle(2.5).extrude(PT + 2))
    return p


def sprocket():
    # built along +Z (hub at z=0), rotated so +Z -> -Y
    s = cq.Workplane("XY").circle(7).extrude(5)
    s = s.union(cq.Workplane("XY", origin=(0, 0, 5)).circle(19.5).extrude(1.5))
    s = s.union(cq.Workplane("XY", origin=(0, 0, 6.5)).circle(16.2).extrude(5))
    s = s.union(cq.Workplane("XY", origin=(0, 0, 11.5)).circle(19.5).extrude(1.5))
    s = s.cut(cq.Workplane("XY", origin=(0, 0, 8.2)).circle(16.5).circle(13.3).extrude(1.6))
    for i in range(16):
        a = 2 * math.pi * i / 16
        s = s.cut(cq.Workplane("XY").sphere(2.45).translate(
            (PITCH_R * math.cos(a), PITCH_R * math.sin(a), 9.0)))
    bore = cq.Workplane("XY").circle(2.55).extrude(14).cut(
        cq.Workplane("XY").box(10, 10, 14, centered=(False, True, False)).translate((2.05, 0, 0)))
    s = s.cut(bore.translate((0, 0, -0.5)))
    return s.rotate((0, 0, 0), (1, 0, 0), 90).translate((0, FRONT - PT - 3, MZ))


def chain():
    yc = FRONT - PT - 3 - 9.0
    pts = [(PITCH_R * math.cos(math.pi + math.pi * i / 8), PITCH_R * math.sin(math.pi + math.pi * i / 8))
           for i in range(9)]
    for k in range(1, 26):
        pts += [(-PITCH_R, k * 6), (PITCH_R, k * 6)]
    balls = [cq.Solid.makeSphere(2.25, cq.Vector(x, yc, MZ + z)) for x, z in pts]
    return cq.Compound.makeCompound(balls)


def parts():
    return [
        {"name": "Body", "shape": body(), "color": "#ecebe7", "explode": [0, 1, 0]},
        {"name": "Front plate", "shape": front_plate(), "color": "#3b3f45", "explode": [0, -1, 0]},
        {"name": "Sprocket", "id": "Sprocket", "shape": sprocket(), "color": "#f08a24", "explode": [0, -1, 0]},
        {"name": "Your blind's bead chain (reference)", "shape": chain(), "group": "component",
         "process": "bought", "color": "#c9ccd1"},
        part("nema17_48", at=(0, FRONT, MZ), rot=(90, 0, 0)),
        {"name": "Perfboard 50x70", "shape": cq.Workplane("XY").box(52, 34, 1.6, centered=(True, True, False))
         .translate((-6, 0, 13)), "group": "component", "color": "#3d7a3a"},
        part("tmc2209", at=(-19, 9, 14.6)),
        part("mp1584", at=(-19, -8, 14.6)),
        part("esp32_c3_supermini", at=(8, 0, 14.6)),
        part("dc_jack_panel", at=(27, 20, 0), rot=(180, 0, 0)),
        part("m3_insert", at=[(x, FRONT + 6, z) for x, z in BOSS], rot=(90, 0, 0)),
        part("m3x10_shcs", at=[(x, FRONT - PT, z) for x, z in BOSS], rot=(90, 0, 0)),
        part("m3x8_shcs", at=[(x, FRONT - PT, z) for x, z in MOTOR_SCREWS], rot=(90, 0, 0)),
        part("led_5mm", at=(0, FRONT - PT + 0.5, 40), rot=(90, 0, 0)),
    ]


def motion():
    return [{"part": "Sprocket", "type": "spin", "axis": [0, -1, 0], "pivot": [0, 0, MZ], "turns": 1}]
