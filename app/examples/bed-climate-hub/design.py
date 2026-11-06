import cadquery as cq
from cadlib import fab
from cadlib.parts import part

# Bed climate hub: 12 V Peltier chiller/heater that pumps water through a
# generic 70 x 160 cm water mattress pad (6 mm hoses, bought).
W, D, H = 240.0, 170.0, 125.0   # hub outer: width X, depth Y, height Z (panels add 3 mm each end)
T = 1.5                         # sheet thickness
P = 3.0                         # acrylic panel thickness
ZB = 5.0                        # base tray bottom (rubber feet below)
ZF = ZB + T                     # floor top
ZT = ZB + H                     # cover top surface

TEC = (60.0, 25.0)              # Peltier stack centre (x, y)
RES = (-85.0, 40.0)             # reservoir centre
PUMP = (-85.0, -25.0)
UI_Z = ZB + 85.0                # front display / knob height
OLED_X, KNOB_X = -20.0, 60.0
HOSE_X, JACK_X, PORT_Z = (-35.0, -12.0), 20.0, ZB + 30.0


def box(x, y, z, cx, cy, z0):
    return cq.Workplane("XY").box(x, y, z, centered=(True, True, False)).translate((cx, cy, z0))


def cyl(d, h, cx, cy, z0):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((cx, cy, z0))


def ycyl(d, length, x, y0, z):
    """Cylinder along +Y starting at y0."""
    return cq.Workplane("XZ").circle(d / 2).extrude(-length).translate((x, y0, z))


def soft(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def cover():
    hx = W / 2 - T / 2
    c = fab.sheet_bent([(-hx, ZB + 2), (-hx, ZT - T / 2), (hx, ZT - T / 2), (hx, ZB + 2)], D, T).translate((0, -D / 2, 0))
    # fan intake grille over the heatsink fan
    pts = [(TEC[0] + i * 9, TEC[1] + j * 9) for i in range(-4, 5) for j in range(-4, 5) if (i * i + j * j) * 81 <= 40 ** 2]
    c = c.cut(cq.Workplane("XY").pushPoints(pts).circle(3).extrude(10).translate((0, 0, ZT - 5)))
    # reservoir fill hole
    c = c.cut(cyl(26, 10, RES[0], RES[1], ZT - 5))
    # exhaust slots on the right side, beside the heatsink fins
    for k in range(6):
        c = c.cut(box(10, 4, 40, W / 2, TEC[1] - 25 + k * 10, ZF + 25))
    # side screw holes into the base flanges
    for sx in (-1, 1):
        for y in (-55, 55):
            c = c.cut(cq.Workplane("YZ").circle(1.7).extrude(10).translate((sx * W / 2 - 5, y, ZB + 10)))
    return c


def base_tray():
    bx = W - 2 * T
    t = box(bx, D, T, 0, 0, ZB)
    for sx in (-1, 1):   # side flanges, inside the cover walls
        t = t.union(box(T, D - 4, 16, sx * (bx / 2 - T / 2), 0, ZB))
    for sy in (-1, 1):   # end flanges, behind the acrylic panels
        t = t.union(box(bx - 8, T, 14, 0, sy * (D / 2 - T / 2), ZB))
    for x in (-95, 95):  # foot holes
        for y in (-65, 65):
            t = t.cut(cyl(3.4, 5, x, y, ZB - 1))
    return t


def panel(rear):
    sy = 1 if rear else -1
    y0 = sy * D / 2 if rear else -D / 2 - P
    p = soft(box(W, P, H + 2, 0, y0 + P / 2, ZB - 1), "|Y", 6)
    holes = [(x, ZT - 8, 3.4) for x in (-80, 80)] + [(x, ZB + 7, 3.4) for x in (-80, 80)]
    if rear:
        holes += [(x, PORT_Z, 12.5) for x in HOSE_X] + [(JACK_X, PORT_Z, 11.0)]
        for k in range(7):  # heatsink exhaust slots
            p = p.cut(soft(box(6, 10, 40, TEC[0] - 36 + k * 12, y0, ZF + 25), "|Y", 2.9))
    else:
        p = p.cut(soft(box(26, 10, 15, OLED_X, y0, UI_Z - 7.5), "|Y", 1.0))
        holes += [(KNOB_X, UI_Z, 7.5)]
    for x, z, d in holes:
        p = p.cut(ycyl(d, 10, x, y0 - 3, z))
    return p


def top_rail(sy):
    r = box(34, 12, 12, -72, sy * (D / 2 - T - 6), ZT - T - 12).union(box(34, 12, 12, 72, sy * (D / 2 - T - 6), ZT - T - 12))
    for x in (-80, 80):
        r = r.cut(ycyl(4.0, 7, x, sy * (D / 2 - T) - (7 if sy > 0 else 0), ZT - 8))     # panel inserts
        r = r.cut(cyl(4.0, 7, x + (20 if x < 0 else -20), sy * (D / 2 - T - 6), ZT - T - 7))  # cover inserts
    return soft(r, "|X", 1.5)


def tec_cradle():
    c = box(70, 60, 14, TEC[0], TEC[1], ZF)
    c = c.cut(box(40.6, 40.6, 11, TEC[0], TEC[1], ZF + 4))
    c = c.cut(box(42, 8, 6, TEC[0], TEC[1] + 22, ZF + 9))       # hose slot (back)
    for dx in (-28, 28):
        for dy in (-23, 23):
            c = c.cut(cyl(4.0, 15, TEC[0] + dx, TEC[1] + dy, ZF + 4))   # clamp-screw inserts
    for dx in (-28, 28):
        c = c.cut(cyl(3.4, 5, TEC[0] + dx, TEC[1], ZF - 1))
    return soft(c, "|Z", 4)


def knob():
    k = ycyl(26, 16, KNOB_X, -D / 2 - P - 17, UI_Z)
    k = soft(k, "<Y", 2)
    for a in range(0, 360, 30):
        k = k.cut(ycyl(3, 20, 0, -D / 2 - P - 18, 13.6).rotate((0, 0, 0), (0, 1, 0), a).translate((KNOB_X, 0, UI_Z)))
    return k


def parts():
    sheet = lambda bends: {"material": "aluminium 5052", "thickness_mm": T, "bends": bends}
    acrylic = {"material": "acrylic", "thickness_mm": P}
    tx, ty = TEC
    out = [
        {"name": "Cover", "shape": cover(), "group": "case", "process": "sheet", "params": sheet(2),
         "color": "#d8dadc", "explode": [0, 0, 1]},
        {"name": "Base Tray", "shape": base_tray(), "group": "case", "process": "sheet", "params": sheet(4), "color": "#b9bcc0"},
        {"name": "Front Panel", "shape": panel(False), "group": "case", "process": "laser", "params": acrylic,
         "color": "#1e1f22", "explode": [0, -1, 0]},
        {"name": "Rear Panel", "shape": panel(True), "group": "case", "process": "laser", "params": acrylic,
         "color": "#1e1f22", "explode": [0, 1, 0]},
        {"name": "Front Top Rail", "shape": top_rail(-1), "group": "case", "color": "#3a3c40"},
        {"name": "Rear Top Rail", "shape": top_rail(1), "group": "case", "color": "#3a3c40"},
        {"name": "TEC Cradle", "shape": tec_cradle(), "group": "case", "color": "#3a3c40"},
        {"name": "Knob", "shape": knob(), "group": "case", "color": "#e8e8e8", "explode": [0, -1, 0]},
        # thermal stack: water block / Peltier / heatsink / fan
        {"name": "Water Block 40mm", "shape": box(40, 40, 12, tx, ty, ZF + 4), "group": "component", "color": "#9aa0a6"},
        {"name": "Peltier TEC1-12706", "shape": box(40, 40, 3.9, tx, ty, ZF + 16), "group": "component", "color": "#f2f2f2"},
        {"name": "Heatsink 92mm", "shape": box(92, 92, 45, tx, ty, ZF + 20).cut(
            cq.Workplane("XY").pushPoints([(tx - 41 + i * 6.5, ty) for i in range(13)]).rect(3.5, 94).extrude(39).translate((0, 0, ZF + 26))),
         "group": "component", "color": "#c0c4c8"},
        {"name": "Fan 92mm", "shape": box(92, 92, 25, tx, ty, ZF + 65).cut(cyl(86, 30, tx, ty, ZF + 63)).union(cyl(36, 25, tx, ty, ZF + 65)),
         "group": "component", "color": "#222222"},
        # water loop
        {"name": "Pump 12V DC", "shape": cyl(40, 45, PUMP[0], PUMP[1], ZF).union(ycyl(8, 25, PUMP[0], PUMP[1], ZF + 25)),
         "group": "component", "color": "#333333"},
        {"name": "Reservoir 250ml", "shape": cyl(60, 105, RES[0], RES[1], ZF).union(cyl(24, 13, RES[0], RES[1], ZF + 105)),
         "group": "component", "color": "#a8d8f0"},
        {"name": "Fill Cap", "shape": cyl(30, 6, RES[0], RES[1], ZT), "group": "component", "color": "#1e1f22"},
        {"name": "6mm Hose Bulkhead", "shape": ycyl(12, 10, HOSE_X[0], D / 2 - 6, PORT_Z).union(ycyl(6.5, 20, HOSE_X[0], D / 2 + 4, PORT_Z))
            .union(ycyl(12, 10, HOSE_X[1], D / 2 - 6, PORT_Z)).union(ycyl(6.5, 20, HOSE_X[1], D / 2 + 4, PORT_Z)),
         "group": "component", "color": "#c9a24a"},
        # electronics
        {"name": "ESP32 Screw Terminal Board", "shape": box(75, 65, 1.6, -15, -40, ZF + 10), "group": "component", "color": "#1d5c2e"},
        part("esp32_devkitc", at=(-15, -40, ZF + 20)),
        part("m3x10_standoff", at=[(-15 + dx, -40 + dy, ZF) for dx in (-33, 33) for dy in (-28, 28)]),
        {"name": "BTS7960 H-Bridge", "shape": box(50, 50, 28, tx, -55, ZF), "group": "component", "color": "#a33a2a"},
        part("oled_096", at=(OLED_X, -D / 2 + 5, UI_Z), rot=(90, 0, 0)),
        {"name": "EC11 Encoder", "shape": box(12, 12, 7, KNOB_X, -D / 2 + 3.5, UI_Z - 6).union(ycyl(6, 20, KNOB_X, -D / 2 - P - 17, UI_Z)),
         "group": "component", "color": "#555555"},
        part("dc_jack_panel", at=(JACK_X, D / 2 + P, PORT_Z), rot=(-90, 0, 0)),
        {"name": "Rubber Foot", "shape": cq.Workplane("XY").pushPoints([(x, y) for x in (-95, 95) for y in (-65, 65)]).circle(6).extrude(ZB),
         "group": "component", "color": "#111111"},
        part("m3x12_bhcs", at=[(x, -D / 2 - P, ZT - 8) for x in (-80, 80)] + [(x, -D / 2 - P, ZB + 7) for x in (-80, 80)], rot=(-90, 0, 0)),
        part("m3x12_bhcs", at=[(x, D / 2 + P, ZT - 8) for x in (-80, 80)] + [(x, D / 2 + P, ZB + 7) for x in (-80, 80)], rot=(90, 0, 0)),
        part("m3x12_bhcs", at=[(-W / 2, y, ZB + 10) for y in (-55, 55)], rot=(0, -90, 0)),
        part("m3x12_bhcs", at=[(W / 2, y, ZB + 10) for y in (-55, 55)], rot=(0, 90, 0)),
        part("m3x12_bhcs", at=[(x, sy * (D / 2 - T - 6), ZT) for x in (-60, 60) for sy in (-1, 1)]),
        part("m3_insert", at=[(x, sy * (D / 2 - T - 6), ZT - T - 7) for x in (-60, 60) for sy in (-1, 1)]),
        part("m3_insert", at=[(x, -D / 2 + T + 7, ZT - 8) for x in (-80, 80)], rot=(90, 0, 0)),
        part("m3_insert", at=[(x, D / 2 - T - 7, ZT - 8) for x in (-80, 80)], rot=(-90, 0, 0)),
        part("m3_nut", at=[(x, -D / 2 + T + 2.4, ZB + 7) for x in (-80, 80)], rot=(90, 0, 0)),
        part("m3_nut", at=[(x, D / 2 - T - 2.4, ZB + 7) for x in (-80, 80)], rot=(-90, 0, 0)),
        part("m3_nut", at=[(-W / 2 + 2 * T + 2.4, y, ZB + 10) for y in (-55, 55)], rot=(0, 90, 0)),
        part("m3_nut", at=[(W / 2 - 2 * T - 2.4, y, ZB + 10) for y in (-55, 55)], rot=(0, -90, 0)),
    ]
    return out


def motion():
    return [{"part": "Fan 92mm", "type": "spin", "axis": [0, 0, 1], "pivot": [TEC[0], TEC[1], 0], "turns": 3},
            {"part": "Knob", "type": "rotate", "axis": [0, 1, 0], "pivot": [KNOB_X, 0, UI_Z], "keys": [[0, 0], [0.5, 120], [1, 0]]}]
