import cadquery as cq
from cadlib import fab

# Bed cooling unit: Peltier chiller + pump + reservoir, feeds a water mattress pad.
W, D, H = 240, 200, 140   # chassis outer (x, y, z)
T = 1.5                   # aluminium sheet
PT = 3                    # laser-cut acrylic panel thickness
TEC_X = (-58, 58)         # two Peltier stacks
TEC_Y = 30
STAND_H = 48              # printed stand under each cold block


def box(x, y, z, cx, cy, z0):
    return cq.Workplane("XY").box(x, y, z, centered=(True, True, False)).translate((cx, cy, z0))


def cyl(r, h, cx, cy, z0):
    return cq.Workplane("XY").circle(r).extrude(h).translate((cx, cy, z0))


def chassis():
    u = box(W, D, T, 0, 0, 0)
    for s in (-1, 1):
        u = u.union(box(T, D, H, s * (W - T) / 2, 0, 0))
        # intake slots beside each heatsink
        for i in range(6):
            u = u.cut(box(10, 4, 50, s * (W - T) / 2, TEC_Y - 30 + i * 12, STAND_H + 10))
    # feet holes
    for x in (-95, 95):
        for y in (-80, 80):
            u = u.cut(cyl(1.7, 5, x, y, -1))
    return u


def lid():
    l = box(W + 2 * T, D, T, 0, 0, H)
    for s in (-1, 1):
        l = l.union(box(T, D, 15, s * (W + T) / 2, 0, H - 15 + T))
    for x in TEC_X:  # fan openings + fan screw holes
        l = l.cut(cyl(36, 5, x, TEC_Y, H - 1))
        for dx in (-35.75, 35.75):
            for dy in (-35.75, 35.75):
                l = l.cut(cyl(2.2, 5, x + dx, TEC_Y + dy, H - 1))
    l = l.cut(cyl(11, 5, 70, -55, H - 1))  # reservoir fill cap
    return l


def panel_screws(p, y0):
    # M3 holes into small L brackets riveted/screwed to the chassis corners
    for x in (-(W / 2 - 14), W / 2 - 14):
        for z in (14, H - 14):
            p = p.cut(cq.Workplane("XZ").circle(1.7).extrude(-20).translate((x, y0 - 10, z)))
    return p


def front():
    w, h = W - 2 * T, H - T
    y0 = -D / 2
    p = box(w, PT, h, 0, y0 + PT / 2, T)
    p = panel_screws(p, y0)
    p = p.cut(box(14, 20, 90, 70, y0, T + 20))           # reservoir level window
    p = p.cut(cq.Workplane("XZ").circle(3.75).extrude(-20).translate((0, y0 - 5, 80)))   # encoder
    p = p.cut(cq.Workplane("XZ").circle(2.5).extrude(-20).translate((0, y0 - 5, 110)))   # status LED
    return p


def back():
    w, h = W - 2 * T, H - T
    y0 = D / 2
    p = box(w, PT, h, 0, y0 - PT / 2, T)
    p = panel_screws(p, y0)
    for x in (-75, -45):   # G1/4 bulkheads to the pad
        p = p.cut(cq.Workplane("XZ").circle(7).extrude(-20).translate((x, y0 - 10, 30)))
    p = p.cut(box(16, 20, 8.5, 80, y0 - 5, 36))           # XT60 power inlet
    for i in range(5):                                    # exhaust slots
        p = p.cut(box(4, 20, 50, -10 + i * 10, y0 - 5, 70))
    return p


def tec_stand(x):
    # bridge-shaped stand (prints on its side), M3 inserts on top for the heatsink clamp
    s = box(70, 50, STAND_H, x, TEC_Y, T).cut(box(62, 52, STAND_H - 4, x, TEC_Y, T))
    for dx in (-30, 30):
        s = s.union(box(6, 50, 10, x + dx, TEC_Y, T + STAND_H - 10))
    return s


def parts():
    out = [
        {"name": "Chassis", "shape": chassis(), "group": "case", "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": 1.5, "bends": 2}, "color": "#c9ccd1"},
        {"name": "Lid", "shape": lid(), "group": "case", "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": 1.5, "bends": 2}, "color": "#d7dade", "explode": [0, 0, 1]},
        {"name": "Front panel", "shape": front(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#2b2f36", "explode": [0, -1, 0]},
        {"name": "Back panel", "shape": back(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#2b2f36", "explode": [0, 1, 0]},
    ]
    z = T + STAND_H
    for i, x in enumerate(TEC_X, 1):
        out += [
            {"name": f"TEC stand {i}", "shape": tec_stand(x), "group": "case", "color": "#3a3f47"},
            {"name": f"Cold water block {i}", "shape": box(40, 40, 12, x, TEC_Y, z)
                .union(cq.Workplane("XZ").circle(4).extrude(-12).translate((x - 10, TEC_Y - 26, z + 6)))
                .union(cq.Workplane("XZ").circle(4).extrude(-12).translate((x + 10, TEC_Y - 26, z + 6))),
             "group": "component", "color": "#9aa3ad"},
            {"name": f"Peltier TEC1-12706 {i}", "shape": box(40, 40, 3.8, x, TEC_Y, z + 12), "group": "component", "color": "#f2f2f2"},
            {"name": f"Heatsink {i}", "shape": box(90, 90, 6, x, TEC_Y, z + 15.8)
                .union(cq.Workplane("XY").rarray(9, 1, 10, 1).rect(1.5, 90).extrude(29).translate((x, TEC_Y, z + 21.8))),
             "group": "component", "color": "#b0b5bb"},
            {"name": f"80 mm fan {i}", "shape": box(80, 80, 25, x, TEC_Y, H - 25).cut(cyl(37, 25, x, TEC_Y, H - 25))
                .union(cyl(14, 25, x, TEC_Y, H - 25)), "group": "component", "color": "#222222"},
        ]
    out += [
        {"name": "Reservoir 60x120", "shape": cyl(30, 120, 70, -55, T + 2).union(cyl(10, 8, 70, -55, T + 122)),
         "group": "component", "color": "#8fd0ff"},
        {"name": "12V pump", "shape": cyl(20, 45, -65, -55, T).union(
            cq.Workplane("YZ").circle(4).extrude(15).translate((-45, -55, T + 15))),
         "group": "component", "color": "#333333"},
        {"name": "ESP32-C3 SuperMini", "shape": fab.esp32_devkit("c3mini").translate((0, -80, T + 4)), "group": "component"},
        {"name": "Rotary encoder", "shape": box(12, 7, 12, 0, -D / 2 + PT + 3.5, 74).union(
            cq.Workplane("XZ").circle(10).extrude(15).translate((0, -D / 2, 80))), "group": "component", "color": "#555555"},
        {"name": "5V buck MP1584", "shape": fab.buck("mp1584").translate((40, 82, T)), "group": "component"},
    ]
    for i, x in enumerate((-80, -40, 0), 1):
        out.append({"name": f"MOSFET module {i}", "shape": box(34, 17, 10, x, 82, T), "group": "component", "color": "#1f6fb2"})
    for x in (-95, 95):
        for y in (-80, 80):
            out.append({"name": "Rubber foot", "shape": cyl(6, 5, x, y, -5), "group": "component", "color": "#111111"})
    return out
