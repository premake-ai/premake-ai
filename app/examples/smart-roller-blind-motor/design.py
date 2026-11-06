import math
import cadquery as cq
from cadlib.parts import part

# Motorised bead-chain roller blind opener, simple version:
# 28BYJ-48 geared stepper + ULN2003 board + ESP32, all plug-in Dupont wiring, USB powered.
# Standard roller-blind chain (#10): 4.5 mm balls, 6 mm pitch.
W, D, H = 110, 46, 76        # housing + cover outer (X, Y, Z); cover y=0..T
T = 2.5                      # front cover thickness
WALL = 1.8
R = 8                        # outer corner radius
MX, MZ = 31, 40              # motor shaft centre (x, z)
BODY_DZ = -8                 # 28BYJ-48 body centre is 8 mm below the shaft
TAB = 17.5                   # mounting tabs at +-17.5 mm (35 mm apart)
BALL, PITCH, N = 4.5, 6.0, 12
PCR = (PITCH / 2) / math.sin(math.pi / N)   # 11.59 mm pitch radius
CAV = 16                     # chain cavity radius in the guard
GR = 23                      # guard outer radius
SHAFT_TIP = T - 10           # shaft sticks out ~10 mm past the motor face
SPR_Y = -0.5                 # sprocket back face; 7 mm hub to the shaft tip
CHAIN_Y = SPR_Y - 3.5        # chain plane
GF = -12                     # guard front face (y)
COVER_SCREWS = [(sx * (W / 2 - 7), z) for sx in (-1, 1) for z in (7, H - 7)]
MOTOR_HOLES = [(MX + sx * TAB, MZ + BODY_DZ) for sx in (-1, 1)]
# ESP32 DevKitC slid into rails at the top, pins facing the front
E_X, E_Z, E_Y = -24.3, 56, 37            # PCB centre, PCB back face y
# ULN2003 driver board (35 x 32) in rails below, parts facing the front
U_X, U_Z, U_Y = -24, 20, 42.6
BTN = (-45, 18)


def xz_cyl(x, z, r, y0, y1):
    return (cq.Workplane("XZ", origin=(0, y0, 0)).center(x, z).circle(r)
            .extrude(-(y1 - y0)))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def rails(cx, w, z0, z1, y_pcb, y_back):
    """Card-guide rails above and below a PCB (z0..z1) with 1.9 mm grooves.
    The PCB slides in from the side; the top rail flexes so it can also snap in."""
    r = (box(cx - w / 2, cx + w / 2, y_pcb - 4, y_back + 0.5, z0 - 4, z0 + 1)
         .union(box(cx - w / 2, cx + w / 2, y_pcb - 4, y_back + 0.5, z1 - 1, z1 + 4)))
    groove = (box(cx - w / 2 - 1, cx + w / 2 + 1, y_pcb - 0.15, y_pcb + 1.75, z0 - 0.4, z0 + 1.1)
              .union(box(cx - w / 2 - 1, cx + w / 2 + 1, y_pcb - 0.15, y_pcb + 1.75,
                         z1 - 1.1, z1 + 0.4)))
    return r, groove


def housing():
    body = (cq.Workplane("XZ", origin=(0, T, 0)).center(0, H / 2).rect(W, H)
            .extrude(-(D - T)).edges("|Y").fillet(R))
    body = body.faces("<Y").shell(-WALL)
    try:
        body = body.faces(">Y").edges().fillet(2)
    except Exception:
        pass
    for sx in (-1, 1):                        # wall ears with tension slots
        ear = (cq.Workplane("XZ", origin=(0, D - 5, 0)).center(sx * (W / 2 + 5), H / 2)
               .rect(22, 50).extrude(-5).edges("|Y").fillet(5))
        body = body.union(ear)
        slot = (cq.Workplane("XZ", origin=(0, D + 1, 0)).center(sx * (W / 2 + 8), H / 2)
                .slot2D(30, 4.6, angle=90).extrude(8))
        body = body.cut(slot)
    for x, z in COVER_SCREWS:                 # insert bosses for the cover
        body = body.union(xz_cyl(x, z, 4.5, T, D - 1))
        body = body.cut(xz_cyl(x, z, 2.0, T - 1, T + 7))
    back = D - WALL
    r1, g1 = rails(E_X, 40, E_Z - 13.95, E_Z + 13.95, E_Y, back)
    r2, g2 = rails(U_X, 28, U_Z - 16, U_Z + 16, U_Y, back)
    body = body.union(r1).union(r2).cut(g1).cut(g2)
    usb = (cq.Workplane("YZ", origin=(-W / 2 - 1, 0, 0)).center(E_Y + 3, E_Z)
           .rect(12, 8).extrude(WALL + 2).edges("|X").fillet(1.5))
    return body.cut(usb)


def cover():
    plate = (cq.Workplane("XZ").center(0, H / 2).rect(W, H).extrude(-T)
             .edges("|Y").fillet(R))
    # chain guard: U-shaped wall round the sprocket, open at the top
    outline = xz_cyl(MX, MZ, GR, GF, 0).union(
        cq.Workplane("XZ").center(MX, (MZ + H) / 2).rect(2 * GR, H - MZ).extrude(-GF))
    cav = xz_cyl(MX, MZ, CAV, GF + 2.5, 0.01).union(
        cq.Workplane("XZ", origin=(0, 0.01, 0)).center(MX, (MZ + H + 2) / 2)
        .rect(2 * CAV, H + 2 - MZ).extrude(-(GF + 2.5) + 0.01))
    guard = outline.cut(cav)
    try:
        guard = guard.faces("<Y").edges().fillet(1.5)
    except Exception:
        pass
    c = plate.union(guard)
    c = c.cut(xz_cyl(MX, MZ, 14.5, -1, T + 1))         # motor + sprocket go in from behind
    for x, z in MOTOR_HOLES:                           # inserts from behind, in the guard wall
        c = c.cut(xz_cyl(x, z, 2.0, T - 7, T + 1))
    for x, z in COVER_SCREWS:
        c = c.cut(xz_cyl(x, z, 1.7, -1, T + 1))
    c = c.cut(xz_cyl(*BTN, 6.1, -1, T + 1))
    try:
        c = c.faces("<Y").edges().fillet(1.0)
    except Exception:
        pass
    return c


def sprocket():
    s = cq.Workplane("XY").circle(6).extrude(7)
    s = s.union(cq.Workplane("XY", origin=(0, 0, 0.75)).circle(13.5).extrude(5.5))
    s = s.cut(cq.Workplane("XY", origin=(0, 0, 2.5)).circle(15).circle(9.4).extrude(2.0))
    for k in range(N):
        a = 2 * math.pi * k / N
        s = s.cut(cq.Workplane("XY").sphere(BALL / 2 + 0.2)
                  .translate((PCR * math.cos(a), PCR * math.sin(a), 3.5)))
    # 28BYJ-48 shaft: 5 mm with two flats 3 mm apart, press fit
    bore = (cq.Workplane("XY", origin=(0, 0, -1)).circle(2.5).extrude(9)
            .intersect(cq.Workplane("XY").box(3.0, 6, 20)))
    s = s.cut(bore)
    return s.rotate((0, 0, 0), (1, 0, 0), 90).translate((MX, SPR_Y, MZ))


def chain():
    pts = []
    for k in range(7):                       # wrap under the sprocket
        a = math.pi + math.pi * k / 6
        pts.append((MX + PCR * math.cos(a), MZ + PCR * math.sin(a)))
    for sx in (-1, 1):
        for i in range(1, 26):
            pts.append((MX + sx * PCR, MZ + i * PITCH))
    balls = None
    for x, z in pts:
        b = cq.Workplane("XY").sphere(BALL / 2).translate((x, CHAIN_Y, z))
        balls = b if balls is None else balls.union(b)
    return balls


def motor_28byj():
    bz = MZ + BODY_DZ
    m = xz_cyl(MX, bz, 14, T, T + 19)
    m = m.union(cq.Workplane("XZ", origin=(0, T, 0)).center(MX, bz)
                .rect(2 * TAB + 7, 7).extrude(-0.8))
    m = m.union(box(MX - 8.5, MX + 8.5, T + 19 - 0.01, T + 19 + 3, bz - 14, bz - 4))
    m = m.cut(xz_cyl(MX - TAB, bz, 2.1, T - 1, T + 2)).cut(xz_cyl(MX + TAB, bz, 2.1, T - 1, T + 2))
    m = m.union(xz_cyl(MX, MZ, 4.5, T - 1.5, T + 0.01))
    m = m.union(xz_cyl(MX, MZ, 2.5, SHAFT_TIP, T - 1.4))
    return m


def uln2003():
    b = box(U_X - 17.5, U_X + 17.5, U_Y, U_Y + 1.6, U_Z - 16, U_Z + 16)
    b = b.union(box(U_X - 5, U_X + 5, U_Y - 5, U_Y + 0.01, U_Z - 6, U_Z + 6))        # chip
    b = b.union(box(U_X - 6, U_X + 6, U_Y - 7, U_Y + 0.01, U_Z + 8, U_Z + 14))       # motor socket
    b = b.union(box(U_X + 9, U_X + 12, U_Y - 9, U_Y + 0.01, U_Z - 12, U_Z + 4))      # pins
    return b


def parts():
    return [
        {"name": "Housing", "shape": housing(), "group": "case", "color": "#ece8e0",
         "explode": [0, 1, 0]},
        {"name": "Front Cover", "shape": cover(), "group": "case", "color": "#ece8e0",
         "explode": [0, -1, 0]},
        {"name": "Sprocket", "id": "sprocket", "shape": sprocket(), "group": "case",
         "color": "#3a3a3a", "explode": [0, -1, 0]},
        {"name": "Blind bead chain (yours)", "shape": chain(), "group": "component",
         "color": "#f4f4f4"},
        {"name": "28BYJ-48 geared stepper 5 V", "shape": motor_28byj(), "group": "component",
         "color": "#9aa4ad"},
        {"name": "ULN2003 driver board", "shape": uln2003(), "group": "component",
         "color": "#2a7a3a"},
        {"name": "12 mm push button", "group": "component", "color": "#222222",
         "shape": xz_cyl(*BTN, 6, T, T + 18).union(xz_cyl(*BTN, 7.5, -2, 0))},
        part("esp32_devkitc", at=(E_X, E_Y, E_Z), rot=(-90, 0, 0)),
        part("m3x6_bhcs", at=[(x, T + 0.8, z) for x, z in MOTOR_HOLES], rot=(-90, 0, 0)),
        part("m3x10_bhcs", at=[(x, 0, z) for x, z in COVER_SCREWS], rot=(90, 0, 0)),
        part("m3_insert", at=[(x, T, z) for x, z in COVER_SCREWS], rot=(-90, 0, 0)),
        part("m3_insert", at=[(x, T, z) for x, z in MOTOR_HOLES], rot=(90, 0, 0)),
    ]


def motion():
    return [{"part": "sprocket", "type": "spin", "axis": [0, 1, 0],
             "pivot": [MX, SPR_Y, MZ], "turns": 1}]
