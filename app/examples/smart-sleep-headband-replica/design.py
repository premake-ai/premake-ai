import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info
from cadlib.refmodels import ref

# Flux Sleep control unit: 13.39 x 6.93 x 4.92 in (340 x 176 x 125 mm), 40 in hoses
L, W, H = 340, 176, 125
T3 = fab.sheet_actual("acrylic", 3)      # front / back / tank
T6 = fab.sheet_actual("acrylic", 6)      # ends / top / bottom
INSET = 4                                # box panels sit 4 mm inside the end-panel outline
XI = L / 2 - T6                          # inner face of the end panels
Y0, Y1 = -W / 2 + INSET, W / 2 - INSET   # -84 .. 84
ZB0 = INSET                              # bottom panel underside
ZB1 = ZB0 + T6                           # floor (top of bottom panel)
ZT1 = H - INSET                          # top of top panel
ZT0 = ZT1 - T6                           # ceiling

# Peltier stack, front to back (cold water block -> TECs -> heatsink -> fans -> back panel)
HS_X0, HS_X1 = -17, 133                  # 150 mm heatsink
HS_Z0, HS_Z1 = ZB1, ZB1 + 80
ZC = (HS_Z0 + HS_Z1) / 2                 # stack centre height
Y_FAN1 = Y1 - T3
Y_FAN0 = Y_FAN1 - 25
Y_RB0 = Y_FAN0 - 8                       # rear clamp bar
Y_HS0 = Y_RB0 - 30                       # heatsink base front face
Y_TEC0 = Y_HS0 - 3.8
Y_WB0 = Y_TEC0 - 12
Y_FB0 = Y_WB0 - 10                       # front clamp bar
TEC_X = (38, 78)
FAN_X = (18, 98)
BOLT_X = (-27, 143)

# water tank (3 mm clear acrylic, solvent welded)
TK_X0, TK_X1, TK_Y0, TK_Y1, TK_Z1 = -160, -50, -66, 50, 100
FILL = (-105, -8)
PORT_IN, PORT_OUT = -105, -135           # back-panel hose bulkheads (x), at z=40
PORT_Z = 40
DIN = (-75, 78)                          # 4-pin DIN power socket (x, z) on back

# front controls
OLED_C = (100, 85)
BTN_X, BTN_Z = (70, 88, 106, 124), 50
BTN_NAMES = ("Power", "Cool/Heat", "Eco/Max", "Timer")

SCENE = "floor"
ASSEMBLY = [["Bottom panel"], ["Tank bottom", "Tank front", "Tank back", "Tank left", "Tank right"],
            ["Tank lid", "Fill neck"], ["Heatsink", "Peltier A", "Peltier B", "Water block 40x80"],
            ["Front clamp bar", "Rear clamp bar"], ["Back panel"], ["Front panel"],
            ["Left end panel", "Right end panel"], ["Top panel", "Fill cap"]]


def box(x0, y0, z0, x1, y1, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cyl_y(x, y0, y1, z, d):
    return cq.Workplane("XZ").circle(d / 2).extrude(-(y1 - y0)).translate((x, y0, z))


def cyl_z(x, y, z0, z1, d):
    return cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def soft(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


# ---------------- case: laser-cut white acrylic ----------------
TAB_Z = (35, 90)                          # front/back panel tabs through the end panels
TAB_W = 30
TSLOT_Y = (-50, 50)                       # T-slot screws into top/bottom panel edges


def end_panel(sign):
    x0 = sign * L / 2 if sign < 0 else L / 2 - T6
    p = box(x0, -W / 2, 0, x0 + T6, W / 2, H)
    p = soft(p, "|X", 18)
    sw = fab.slot_width("acrylic", 3)
    for yc in (Y0 + T3 / 2, Y1 - T3 / 2):
        for zc in TAB_Z:
            p = p.cut(box(x0 - 1, yc - sw / 2, zc - TAB_W / 2 - 0.1, x0 + T6 + 1, yc + sw / 2, zc + TAB_W / 2 + 0.1))
    for y in TSLOT_Y:
        for z in ((ZB0 + ZB1) / 2, (ZT0 + ZT1) / 2):
            p = p.cut(cq.Workplane("YZ").circle(1.7).extrude(T6 + 2).translate((x0 - 1, y, z)))
    # intake vents beside the heatsink / tank
    for i in range(7):
        z = 30 + i * 11
        p = p.cut(box(x0 - 1, -45, z, x0 + T6 + 1, 45, z + 5).edges("|X").fillet(2.4))
    return p


def tslots(p, x_end, sign, zmid):
    """T-slot (screw slot + nut pocket) cut into a 6 mm panel edge at x_end, pointing inward (sign)."""
    for y in TSLOT_Y:
        x_in = x_end + sign * 13
        p = p.cut(box(min(x_end, x_in), y - 1.7, zmid - 4, max(x_end, x_in), y + 1.7, zmid + 4))
        xn = x_end + sign * 7
        p = p.cut(box(xn - 1.3, y - 2.95, zmid - 4, xn + 1.3, y + 2.95, zmid + 4))
    return p


def bottom_panel():
    p = box(-XI, Y0, ZB0, XI, Y1, ZB1)
    p = soft(p, "|Z", 3)
    p = tslots(p, -XI, 1, (ZB0 + ZB1) / 2)
    p = tslots(p, XI, -1, (ZB0 + ZB1) / 2)
    # M3 holes for the modules (nylon standoffs)
    holes = [(87, -55), (131, -55), (87, -11), (131, -11),        # BTS7960
             (33, -75), (77, -75), (33, -36), (77, -36),          # Nano terminal board
             (-40, -60), (2, -60),                                # pump
             (-37, -23), (-9, -23), (33, -19), (61, -19)]         # MOSFET modules
    for x, y in holes:
        p = p.cut(cyl_z(x, y, ZB0 - 1, ZB1 + 1, 3.4))
    return p


def top_panel():
    p = box(-XI, Y0, ZT0, XI, Y1, ZT1)
    p = soft(p, "|Z", 3)
    p = tslots(p, -XI, 1, (ZT0 + ZT1) / 2)
    p = tslots(p, XI, -1, (ZT0 + ZT1) / 2)
    p = p.cut(cyl_z(FILL[0], FILL[1], ZT0 - 1, ZT1 + 1, 40.6))
    return p


def long_panel(front):
    y0 = Y0 if front else Y1 - T3
    p = box(-XI, y0, ZB1, XI, y0 + T3, ZT0)
    for s in (-1, 1):
        for zc in TAB_Z:
            xa, xb = (s * XI, s * L / 2)
            p = p.union(box(min(xa, xb) - (0 if s > 0 else 0), y0, zc - TAB_W / 2, max(xa, xb), y0 + T3, zc + TAB_W / 2))
    if front:
        ox, oz = OLED_C
        p = p.cut(box(ox - 12.5, y0 - 1, oz - 1 - 6.5, ox + 12.5, y0 + T3 + 1, oz - 1 + 6.5).edges("|Y").fillet(1))
        for x in BTN_X:
            p = p.cut(cyl_y(x, y0 - 1, y0 + T3 + 1, BTN_Z, 12.2))
    else:
        for fx in FAN_X:
            # round grille: rings of 7 mm holes, then 4 x M4 fan screws on 71.5
            for r, n in ((0, 1), (12, 8), (24, 14), (35, 20)):
                for i in range(n):
                    a = 2 * math.pi * i / n
                    p = p.cut(cyl_y(fx + r * math.cos(a), y0 - 1, y0 + T3 + 1, ZC + r * math.sin(a), 7))
            for dx in (-35.75, 35.75):
                for dz in (-35.75, 35.75):
                    p = p.cut(cyl_y(fx + dx, y0 - 1, y0 + T3 + 1, ZC + dz, 4.4))
        for x in (PORT_IN, PORT_OUT):
            p = p.cut(cyl_y(x, y0 - 1, y0 + T3 + 1, PORT_Z, 12.5))
        p = p.cut(cyl_y(DIN[0], y0 - 1, y0 + T3 + 1, DIN[1], 16.2))
        for x in BOLT_X:
            pass
    return p


# ---------------- water tank (clear acrylic, solvent welded) ----------------
def tank_parts():
    t = T3
    zb0 = ZB1
    pieces = {
        "Tank bottom": box(TK_X0, TK_Y0, zb0, TK_X1, TK_Y1, zb0 + t),
        "Tank front": box(TK_X0, TK_Y0, zb0 + t, TK_X1, TK_Y0 + t, TK_Z1),
        "Tank back": box(TK_X0, TK_Y1 - t, zb0 + t, TK_X1, TK_Y1, TK_Z1),
        "Tank left": box(TK_X0, TK_Y0 + t, zb0 + t, TK_X0 + t, TK_Y1 - t, TK_Z1),
        "Tank right": box(TK_X1 - t, TK_Y0 + t, zb0 + t, TK_X1, TK_Y1 - t, TK_Z1),
        "Tank lid": box(TK_X0, TK_Y0, TK_Z1, TK_X1, TK_Y1, TK_Z1 + t),
    }
    pieces["Tank back"] = pieces["Tank back"].cut(cyl_y(PORT_IN, TK_Y1 - t - 1, TK_Y1 + 1, 85, 12.5))
    pieces["Tank right"] = pieces["Tank right"].cut(
        cq.Workplane("YZ").circle(6.25).extrude(t + 2).translate((TK_X1 - t - 1, -45, 25)))
    lid = pieces["Tank lid"].cut(cyl_z(FILL[0], FILL[1], TK_Z1 - 1, TK_Z1 + t + 1, 40.4))
    lid = lid.cut(cyl_z(-140, 35, TK_Z1 - 1, TK_Z1 + t + 1, 6.5))   # temperature probe grommet
    pieces["Tank lid"] = lid
    out = []
    for n, s in pieces.items():
        out.append({"name": n, "shape": s, "group": "case", "process": "laser",
                    "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_clear"})
    return out


def fill_neck():
    z_lid = TK_Z1 + T3
    tube = cyl_z(FILL[0], FILL[1], TK_Z1 - 4, ZT1 + 0.3, 40).cut(cyl_z(FILL[0], FILL[1], TK_Z1 - 5, ZT1 + 1, 33))
    flange = cyl_z(FILL[0], FILL[1], z_lid, z_lid + 3, 52).cut(cyl_z(FILL[0], FILL[1], z_lid - 1, z_lid + 4, 34))
    return tube.union(flange)


def fill_cap():
    z0 = ZT1 + 0.3
    plug = cyl_z(FILL[0], FILL[1], z0 - 10, z0, 33.4)
    knob = cyl_z(FILL[0], FILL[1], z0, H - 0.5, 46)
    knob = soft(knob, ">Z", 1.5)
    c = plug.union(knob).cut(cyl_z(FILL[0], FILL[1], z0 - 11, z0 - 1.5, 28))
    return c


# ---------------- Peltier stack ----------------
def clamp_bar(y0, depth):
    b = box(BOLT_X[0] - 6, y0, ZC - 8, BOLT_X[1] + 6, y0 + depth, ZC + 8)
    b = soft(b, "|Y", 3)
    for x in BOLT_X:
        b = b.cut(cyl_y(x, y0 - 1, y0 + depth + 1, ZC, 3.4))
    return b


def heatsink():
    hs = box(HS_X0, Y_HS0, HS_Z0, HS_X1, Y_HS0 + 6, HS_Z1)
    n = 22
    pitch = (HS_X1 - HS_X0 - 1.6) / (n - 1)
    for i in range(n):
        x = HS_X0 + i * pitch
        hs = hs.union(box(x, Y_HS0 + 5, HS_Z0, x + 1.6, Y_RB0, HS_Z1))
    return hs


def hose(x):
    pts = [cq.Vector(x, Y1 + 18, PORT_Z), cq.Vector(x, 260, 18), cq.Vector(x * 1.6, 520, 8),
           cq.Vector(x * 1.8, 700, 8)]
    try:
        e = cq.Edge.makeSpline(pts, tangents=[cq.Vector(0, 1, 0), cq.Vector(0, 1, 0)])
        path = cq.Wire.assembleEdges([e])
        prof = cq.Wire.makeCircle(9, pts[0], cq.Vector(0, 1, 0))
        return cq.Workplane().add(cq.Solid.sweep(prof, [], path, True, False))
    except Exception:
        return cyl_y(x, Y1 + 18, 700, PORT_Z, 18)


def pad():
    p = box(-350, 700, 0, 350, 2300, 10)
    p = soft(p, "|Z", 40)
    p = soft(p, ">Z", 3)
    for i in range(1, 16):
        y = 700 + i * 100
        p = p.cut(box(-330, y - 2, 8, 330, y + 2, 11))
    return p


def parts():
    out = []
    case = {"group": "case", "process": "laser", "color": "#f4f4f2", "material": "acrylic_frosted"}
    out.append(dict(case, name="Left end panel", shape=end_panel(-1),
                    params={"material": "acrylic", "thickness_mm": 6}))
    out.append(dict(case, name="Right end panel", shape=end_panel(1),
                    params={"material": "acrylic", "thickness_mm": 6}))
    out.append(dict(case, name="Bottom panel", shape=bottom_panel(),
                    params={"material": "acrylic", "thickness_mm": 6}))
    out.append(dict(case, name="Top panel", shape=top_panel(),
                    params={"material": "acrylic", "thickness_mm": 6}))
    out.append(dict(case, name="Front panel", shape=long_panel(True), color="#2b2d30",
                    params={"material": "acrylic", "thickness_mm": 3}, material=None))
    out.append(dict(case, name="Back panel", shape=long_panel(False),
                    params={"material": "acrylic", "thickness_mm": 3}))
    for d in out:
        if d.get("material") is None:
            d.pop("material")
    out += tank_parts()
    out.append({"name": "Fill neck", "shape": fill_neck(), "group": "case", "color": "#e8e8e6"})
    out.append({"name": "Fill cap", "shape": fill_cap(), "group": "case", "color": "#3a8fd6",
                "params": {"material": "TPU 95A"}})
    out.append({"name": "Front clamp bar", "shape": clamp_bar(Y_FB0, 10), "group": "case", "color": "#555a60"})
    out.append({"name": "Rear clamp bar", "shape": clamp_bar(Y_RB0, 8), "group": "case", "color": "#555a60"})

    # bought: Peltier stack
    out.append({"name": "Heatsink", "shape": heatsink(), "group": "component", "color": "#b9bec4",
                "material": "aluminium"})
    for n, x in zip(("Peltier A", "Peltier B"), TEC_X):
        out.append({"name": n, "group": "component", "color": "#f0f0ea",
                    "shape": box(x - 20, Y_TEC0, ZC - 20, x + 20, Y_HS0, ZC + 20)})
    wb = box(TEC_X[0] - 20, Y_WB0, ZC - 20, TEC_X[1] + 20, Y_TEC0, ZC + 20)
    for z in (ZC - 10, ZC + 10):
        wb = wb.union(cq.Workplane("YZ").circle(3).extrude(14).translate((TEC_X[1] + 19, (Y_WB0 + Y_TEC0) / 2, z)))
    out.append({"name": "Water block 40x80", "shape": wb, "group": "component", "material": "aluminium",
                "color": "#c8ccd0"})
    for i, x in enumerate(FAN_X):
        out.append(ref("fan_80", at=(x, Y_FAN0, ZC), rot=(-90, 0, 0), yours=False, price=6.0,
                       search="80mm 12V quiet case fan 2 pin") if i == 0 else
                   ref("fan_80", at=(x, Y_FAN0, ZC), rot=(-90, 0, 0), yours=False, price=6.0,
                       search="80mm 12V quiet case fan 2 pin"))
    # clamp: 2 x M3x70 through both bars, nuts behind the rear bar
    out.append(part("m3x70_shcs", at=[(x, Y_FB0, ZC) for x in BOLT_X], rot=(90, 0, 0)))
    out.append(part("m3_nylock", at=[(x, Y_RB0 + 8, ZC) for x in BOLT_X], rot=(-90, 0, 0)))
    # case: M3x16 button heads through the end panels into T-slots in the top / bottom panels
    zs = ((ZB0 + ZB1) / 2, (ZT0 + ZT1) / 2)
    out.append(part("m3x16_bhcs", at=[(s * L / 2, y, z) for s in (-1, 1) for y in TSLOT_Y for z in zs],
                    rot=[(0, -90, 0) if s < 0 else (0, 90, 0) for s in (-1, 1) for y in TSLOT_Y for z in zs]))
    out.append(part("m3_nut", at=[(s * (XI - 7) - 1.2, y, z) for s in (-1, 1) for y in TSLOT_Y for z in zs],
                    rot=(0, 90, 0)))

    # pump, electronics
    out.append({"name": "12V brushless pump", "group": "component", "color": "#1d1f22",
                "shape": soft(box(-44, -78, ZB1, 6, -38, ZB1 + 40), "|Y", 8)})
    out.append({"name": "BTS7960 H-bridge", "group": "component", "color": "#c62a2a",
                "shape": box(84, -58, ZB1 + 4, 134, -8, ZB1 + 6).union(box(92, -50, ZB1 + 6, 126, -16, ZB1 + 43))})
    out.append({"name": "Nano screw-terminal board", "group": "component", "color": "#2a5bc6", "material": "pcb",
                "shape": box(30, -78, ZB1 + 4, 80, -33, ZB1 + 6).union(box(30, -78, ZB1 + 6, 80, -70, ZB1 + 16))
                         .union(box(30, -41, ZB1 + 6, 80, -33, ZB1 + 16))})
    ni = info("arduino_nano")
    out.append(part("arduino_nano", at=(55, -55.5, ZB1 + 6 + 8.5 + 3)))
    for n, (x0, y0) in zip(("Pump MOSFET module", "Fan MOSFET module"), ((-40, -32), (30, -28))):
        out.append({"name": n, "group": "component", "color": "#1f6fd1",
                    "shape": box(x0, y0, ZB1 + 4, x0 + 34, y0 + 17, ZB1 + 14)})
    oi = info("oled_096")
    oh = oi["bbox_max"][2]
    out.append(part("oled_096", at=(OLED_C[0], Y0 + T3 + oh + 0.3, OLED_C[1]), rot=(90, 0, 0)))
    for x, n in zip(BTN_X, BTN_NAMES):
        b = cyl_y(x, Y0 - 2.5, Y0 + T3 + 18, BTN_Z, 11.8).union(cyl_y(x, Y0 - 2.5, Y0, BTN_Z, 15))
        out.append({"name": f"{n} button", "group": "component", "color": "#d9dde2", "material": "steel",
                    "shape": b, "fx": {"glow": {"color": "#33ccff"}}})
    out.append({"name": "DIN power socket", "group": "component", "color": "#222222",
                "shape": cyl_y(DIN[0], Y1 - T3 - 22, Y1 + 2, DIN[1], 16).union(
                    cyl_y(DIN[0], Y1, Y1 + 2, DIN[1], 22)),
                "cable": {"type": "dc-barrel", "at": [DIN[0], Y1 + 2, DIN[1]], "dir": [0, 1, 0], "length_mm": 600}})
    for x, n in ((PORT_IN, "IN"), (PORT_OUT, "OUT")):
        out.append({"name": f"Hose bulkhead {n}", "group": "component", "color": "#c9a54a", "material": "brass",
                    "shape": cyl_y(x, Y1 - T3 - 14, Y1 + 18, PORT_Z, 8).union(cyl_y(x, Y1, Y1 + 3, PORT_Z, 18))})
        out.append({"name": f"Insulated hose {n}", "group": "component", "color": "#e6e9ec", "shape": hose(x)})
    out.append({"name": "Water cooling pad", "group": "component", "color": "#dfe8f1", "shape": pad()})
    return out
