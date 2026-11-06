import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "desk"
ASSEMBLY = [["Base"], ["Rubber feet"], ["ESP32 DevKitC (WROOM-32, 38 pin)"], ["Board clamp"], ["BME280 sensor"], ["Lid"]]

L, W, H = 96, 50, 30      # base outer (walls), lid adds LID_T on top
WALL = 2.4
LID_T = 2.5
R = 6                     # outer corner radius
Z0 = 2.5                  # rubber feet height
FLOOR = Z0 + WALL         # top of floor
ZTOP = Z0 + H             # top of walls = lid underside
IX, IY = L / 2 - WALL, W / 2 - WALL   # inner half sizes

# ESP32 DevKitC V4 (54.4 x 27.9, WROOM can top 4.7 above PCB bottom, pins 8.5 below)
BX = -IX + 1.5 + 27.2     # board centre x, micro-USB 1.5 mm from the wall
BZ = 15.0                 # PCB bottom
CAN_X = BX + 10.5         # WROOM shield can centre
CLAMP_Z = BZ + 4.7        # clamp underside = module top
POST_Y = 19.8
# BME280 module (~15 x 12, one 3 mm hole)
SX, SZ = 31.0, 11.0
SHOLE_X = SX + 5.0
BAFFLE_X = 15.0
LIP_D, LIP_T, GAP = 6.0, 1.6, 0.3


def rrect(hx, hy, r, h, z):
    return cq.Workplane("XY").rect(2 * hx, 2 * hy).extrude(h).edges("|Z").fillet(r).translate((0, 0, z))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def base():
    b = rrect(L / 2, W / 2, R, H, Z0)
    try:
        b = b.faces("<Z").edges().fillet(2)
    except Exception:
        pass
    b = b.cut(rrect(IX, IY, R - WALL, H, FLOOR))
    # board rails, end stop, side guides
    for x in (BX - 24.2, BX + 24.2):
        b = b.union(box(x - 1, x + 1, -9, 9, FLOOR - 1, BZ))
    b = b.union(box(BX + 27.5, BX + 29.5, -6, 6, FLOOR - 1, BZ + 3))
    for x in (BX - 20, BX + 18):
        for s in (-1, 1):
            b = b.union(box(x - 1, x + 1, s * 14.3 - (0 if s > 0 else 2), s * 14.3 + (2 if s > 0 else 0), FLOOR - 1, BZ + 3))
    # clamp screw posts, joined to the long walls
    for s in (-1, 1):
        boss, hole = fab.screw_boss(2.5, h=CLAMP_Z - FLOOR + 1, depth=8, at=(CAN_X, s * POST_Y, FLOOR - 1))
        b = b.union(boss).cut(hole)
    # baffle between board and sensor chamber, with a wire notch
    b = b.union(box(BAFFLE_X, BAFFLE_X + 2, -IY - 0.5, IY + 0.5, FLOOR - 1, ZTOP - LIP_D - 0.5))
    b = b.union(box(BAFFLE_X, BAFFLE_X + 2, -(IY - GAP - LIP_T - 0.4), IY - GAP - LIP_T - 0.4, FLOOR - 1, ZTOP - 0.3))
    b = b.cut(box(BAFFLE_X - 1, BAFFLE_X + 3, 10, 16, FLOOR, FLOOR + 6))
    # sensor post + rest pillar
    boss, hole = fab.screw_boss(2.5, h=SZ - FLOOR + 1, depth=7, at=(SHOLE_X, 0, FLOOR - 1))
    b = b.union(boss).cut(hole)
    b = b.union(box(SX - 6, SX - 4, -4, 4, FLOOR - 1, SZ))
    # vents: sensor chamber sides and end, board chamber low intakes
    for x in range(21, 43, 4):
        for s in (-1, 1):
            b = b.cut(box(x - 1, x + 1, min(s * (IY - 1), s * W), max(s * (IY - 1), s * W), FLOOR + 3, ZTOP - LIP_D - 2))
    for y in range(-15, 16, 5):
        b = b.cut(box(IX - 1, L, y - 1, y + 1, FLOOR + 3, ZTOP - LIP_D - 2))
    for y in (-16, -11, 11, 16):
        b = b.cut(box(-L, -IX + 1, y - 1, y + 1, FLOOR + 2, FLOOR + 9))
    # micro-USB plug opening (plug overmould ~12 x 8)
    uz = BZ + 1.6 + 1.4
    b = b.cut(box(-L, -IX + 1, -6.5, 6.5, uz - 4.5, uz + 4.5))
    # snap groove in long walls + pry notch on the front
    gz = ZTOP - 3
    for s in (-1, 1):
        y0 = s * IY
        b = b.cut(box(-IX + 8, IX - 8, min(y0, y0 + s * 0.9), max(y0, y0 + s * 0.9), gz - 0.9, gz + 0.9))
    b = b.cut(box(-7, 7, -W, -IY + 1, ZTOP - 1.5, ZTOP + 1))
    return b


def lid():
    p = rrect(L / 2, W / 2, R, LID_T, ZTOP)
    try:
        p = p.faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    lo = rrect(IX - GAP, IY - GAP, R - WALL - GAP, LIP_D + 1, ZTOP - LIP_D)
    li = rrect(IX - GAP - LIP_T, IY - GAP - LIP_T, 1.5, LIP_D + 2, ZTOP - LIP_D - 1)
    p = p.union(lo.cut(li))
    # baffle slot in the lip so the baffle top passes
    p = p.cut(box(BAFFLE_X - 0.3, BAFFLE_X + 2.3, -(IY - GAP - LIP_T - 0.2), IY - GAP - LIP_T - 0.2, ZTOP - LIP_D - 1, ZTOP))
    # snap bumps (triangular, 0.7 proud)
    gz = ZTOP - 3
    for s in (-1, 1):
        tri = (cq.Workplane("YZ").polyline([(0, -0.8), (s * 0.7, 0), (0, 0.8)]).close().extrude(2 * IX - 24)
               .translate((-IX + 12, s * (IY - GAP - 0.5), gz)))
        bump = tri.union(box(-IX + 12, IX - 12, min(s * (IY - GAP - 0.5), s * (IY - GAP)), max(s * (IY - GAP - 0.5), s * (IY - GAP)), gz - 0.8, gz + 0.8))
        p = p.union(bump)
    # top vents: over the board (heat out) and the sensor chamber
    for x in [-38 + 5 * i for i in range(10)] + [22, 26.5, 31, 35.5, 40]:
        p = p.cut(box(x - 1, x + 1, -12, 12, ZTOP - 1, ZTOP + LID_T + 1))
    return p


def clamp():
    c = box(CAN_X - 4, CAN_X + 4, -POST_Y - 3.2, POST_Y + 3.2, CLAMP_Z, CLAMP_Z + 3.5)
    for s in (-1, 1):   # relief over the header pins, only the centre pad touches the WROOM can
        c = c.cut(box(CAN_X - 5, CAN_X + 5, min(s * 8, s * 16.5), max(s * 8, s * 16.5), CLAMP_Z - 1, CLAMP_Z + 1.5))
    c = c.faces(">Z").workplane().pushPoints([(CAN_X, -POST_Y), (CAN_X, POST_Y)]).hole(2.9)
    try:
        c = c.edges("|Z").fillet(1.5)
    except Exception:
        pass
    return c


def parts():
    bme = box(SX - 7.5, SX + 7.5, -6, 6, SZ, SZ + 1.6).union(box(SX - 1.5, SX + 1.5, -1.5, 1.5, SZ + 1.6, SZ + 2.6))
    bme = bme.cut(cq.Workplane("XY").circle(1.5).extrude(5).translate((SHOLE_X, 0, SZ - 1)))
    feet = None
    for x in (-L / 2 + 10, L / 2 - 10):
        for y in (-W / 2 + 9, W / 2 - 9):
            f = cq.Workplane("XY").circle(4).extrude(Z0).translate((x, y, 0))
            feet = f if feet is None else feet.union(f)
    return [
        {"name": "Base", "shape": base(), "color": "#eceae4"},
        {"name": "Lid", "shape": lid(), "color": "#3d7cc9", "explode": [0, 0, 1]},
        {"name": "Board clamp", "shape": clamp(), "color": "#3d7cc9", "explode": [0, 0, 1]},
        part("esp32_devkitc", at=(BX, 0, BZ)),
        {"name": "BME280 sensor", "shape": bme, "group": "component", "color": "#6a2c91", "material": "pcb"},
        {"name": "Rubber feet", "shape": feet, "group": "component", "color": "#222222", "material": "rubber", "explode": [0, 0, -1]},
        part("m25x8_selftap", at=[(CAN_X, -POST_Y, CLAMP_Z + 3.5), (CAN_X, POST_Y, CLAMP_Z + 3.5), (SHOLE_X, 0, SZ + 1.6)]),
    ]
