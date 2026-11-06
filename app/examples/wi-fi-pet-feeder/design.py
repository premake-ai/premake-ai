import math
import cadquery as cq
from cadlib.parts import part, info

# ---- key dimensions (mm) ----
FEET = 4.0               # rubber feet
BP_T = 6.0               # base plate
PZ = FEET + BP_T         # top of base plate
IW = 104.0               # inside width between side panels (wheel length)
ST = 6.0                 # side panel thickness
XI = IW / 2              # inner face of side panels
YF, YB = -78.0, 78.0     # front / back outer faces
WT = 3.0                 # front / back / ramp / chute acrylic
ZTOP = PZ + 380          # top of side panels
ZA = PZ + 200            # wheel axis height
R_W = 31.5               # wheel vane radius
R_TI, R_TO = 33.0, 34.8  # trough inner / outer radius
TOP_OPEN = 40            # trough top opening half-angle (deg)
BOT_OPEN = 25            # trough bottom opening half-angle
CH_ANG = 32              # chute slope (deg)
CH_Y0, CH_Z0 = 25.0, ZA - 38   # chute top surface reference point
CH_YEND = -140.0         # spout tip
BOWL_Y = -192.0          # bowl centre
BOWL_TOP, BOWL_BOT, BOWL_H = 160.0, 215.0, 50.0   # Mlife 16 oz bowl


def chute_z(y):
    return CH_Z0 + (y - CH_Y0) * math.tan(math.radians(CH_ANG))


def yz_plate(pts, x0, t):
    return cq.Workplane("YZ", origin=(x0, 0, 0)).polyline(pts).close().extrude(t)


def xz_plate(x0, x1, z0, z1, y_out, t, r=0):
    """Plate in XZ, from y_out inward (+Y) by t."""
    w = cq.Workplane("XY").box(x1 - x0, t, z1 - z0).translate(((x0 + x1) / 2, y_out + t / 2, (z0 + z1) / 2))
    if r:
        try:
            w = w.edges("|Y").fillet(r)
        except Exception:
            pass
    return w


def rfillet(w, sel, r):
    try:
        return w.edges(sel).fillet(r)
    except Exception:
        return w


def side_panel(x0, left):
    nose_top = lambda y: chute_z(y) + 36
    nose_bot = lambda y: chute_z(y) - WT - 10
    pts = [(YB, PZ), (YB, ZTOP), (YF, ZTOP), (YF, nose_top(YF)),
           (CH_YEND, nose_top(CH_YEND)), (CH_YEND, nose_bot(CH_YEND)),
           (YF - 6, nose_bot(YF - 6)), (YF, PZ)]
    p = yz_plate(pts, x0, ST)
    p = rfillet(p, "|X", 5)
    # trough location pins
    for s in (1, -1):
        y, z = s * 34 * math.sin(math.radians(100)), ZA + 34 * math.cos(math.radians(100))
        p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, y, z)).circle(1.7).extrude(ST + 2))
    if left:
        # motor boss + 4 x M3 on 31 mm square
        p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, 0, ZA)).circle(11.25).extrude(ST + 2))
        for dy in (-15.5, 15.5):
            for dz in (-15.5, 15.5):
                p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, dy, ZA + dz)).circle(1.7).extrude(ST + 2))
        # motor cable hole + cover screw
        p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, 13, 152)).circle(4).extrude(ST + 2))
        p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, 13, 143)).circle(1.7).extrude(ST + 2))
    else:
        p = p.cut(cq.Workplane("YZ", origin=(x0 - 1, 0, ZA)).circle(4.2).extrude(ST + 2))
    return p


def ramp(sign):
    a = math.radians(TOP_OPEN)
    y0, z0 = sign * R_TO * math.sin(a), ZA + R_TO * math.cos(a)
    y1 = sign * (YB - WT)
    z1 = z0 + abs(y1 - y0)            # 45 deg
    d = WT * math.sqrt(2)
    pts = [(y0, z0), (y1, z1), (y1, z1 - d), (y0, z0 - d)]
    return yz_plate(pts, -XI, IW)


def chute():
    d = WT / math.cos(math.radians(CH_ANG))
    pts = [(CH_Y0, chute_z(CH_Y0)), (CH_YEND, chute_z(CH_YEND)),
           (CH_YEND, chute_z(CH_YEND) - d), (CH_Y0, chute_z(CH_Y0) - d)]
    return yz_plate(pts, -XI, IW)


def trough():
    t = cq.Workplane("YZ", origin=(-XI, 0, ZA)).circle(R_TO).circle(R_TI).extrude(IW)
    for half, up in ((TOP_OPEN, 1), (BOT_OPEN, -1)):
        h = math.radians(half)
        pts = [(0, ZA), (60 * math.sin(h), ZA + up * 60 * math.cos(h)),
               (-60 * math.sin(h), ZA + up * 60 * math.cos(h))]
        t = t.cut(yz_plate(pts, -XI - 1, IW + 2))
    for s in (1, -1):
        y, z = s * 34 * math.sin(math.radians(100)), ZA + 34 * math.cos(math.radians(100))
        for x0 in (-XI - 5, XI - 1):
            t = t.union(cq.Workplane("YZ", origin=(x0, y, z)).circle(1.5).extrude(6))
    # skirt behind the outlet down to the chute, keeps kibble out of the electronics bay
    yb = R_TI * math.sin(math.radians(BOT_OPEN))
    z_top = ZA - R_TI * math.cos(math.radians(BOT_OPEN)) + 3
    z_bot = chute_z(yb + 2) + 0.8
    t = t.union(cq.Workplane("XY").box(IW, 2, z_top - z_bot).translate((0, yb + 1, (z_top + z_bot) / 2)))
    return t


def wheel():
    x0, x1 = -XI + 2.5, XI - 1.0
    L = x1 - x0
    w = cq.Workplane("YZ", origin=(x0, 0, ZA)).circle(7).extrude(L)
    for k in range(6):
        vane = (cq.Workplane("XY").box(L, 1.6, R_W - 5)
                .translate((x0 + L / 2, 0, 5 + (R_W - 5) / 2))
                .rotate((0, 0, 0), (1, 0, 0), 30 + 60 * k)
                .translate((0, 0, ZA)))
        w = w.union(vane)
    # stub axle into right panel
    w = w.union(cq.Workplane("YZ", origin=(x1 - 0.5, 0, ZA)).circle(4).extrude(XI + ST - x1 - 0.5))
    # D bore for 5 mm motor shaft, press fit
    bore = cq.Workplane("YZ", origin=(x0 - 1, 0, ZA)).circle(2.5).extrude(19)
    bore = bore.cut(cq.Workplane("XY").box(40, 10, 2).translate((x0 + 9, 0, ZA + 2.0 + 1)))
    return w.cut(bore)


def motor_cover():
    xo, xd = -XI - ST, 46.0
    outer = cq.Workplane("XY").box(xd, 56, 50).translate((xo - xd / 2, -3, ZA))
    outer = rfillet(outer, "|X", 6)
    outer = rfillet(outer, "<X", 3)
    tail = cq.Workplane("XY").box(14, 24, ZA - 134).translate((xo - 7, 13, (ZA + 134) / 2))
    tail = rfillet(tail, "|X", 3)
    c = outer.union(tail)
    c = c.cut(cq.Workplane("XY").box(xd - 2, 52, 46).translate((xo - (xd - 2) / 2 + 0.01, -3, ZA)))
    c = c.cut(cq.Workplane("XY").box(12, 20, ZA - 140).translate((xo - 6 + 0.01, 13, (ZA + 136) / 2 + 2)))
    boss = cq.Workplane("YZ", origin=(xo - 13, 13, 143)).circle(4.5).extrude(13)
    c = c.union(boss).cut(cq.Workplane("YZ", origin=(xo - 7, 13, 143)).circle(2.0).extrude(8))
    return c


def bowl():
    rb, rt = BOWL_BOT / 2, BOWL_TOP / 2
    o = cq.Workplane("XY").circle(rb).workplane(offset=BOWL_H).circle(rt).loft()
    i = cq.Workplane("XY").workplane(offset=4).circle(rt - 12).workplane(offset=BOWL_H).circle(rt - 1).loft()
    return o.cut(i).translate((0, BOWL_Y, 0))


def base_plate():
    p = cq.Workplane("XY").box(250, 85 - (BOWL_Y - 121), BP_T).translate((0, (85 + BOWL_Y - 121) / 2, FEET + BP_T / 2))
    p = rfillet(p, "|Z", 25)
    for x in (-31, 31):
        for y in (-21, 21):
            p = p.cut(cq.Workplane("XY", origin=(x, PCB_Y + y, 0)).circle(1.7).extrude(20))
    return p.cut(cq.Workplane("XY", origin=(0, BOWL_Y, 0)).circle(111).extrude(20))


PCB_Y, PCB_Z = 20.0, PZ + 10      # perfboard on 10 mm standoffs


def rubber_feet():
    f = None
    for x in (-100, 100):
        for y in (60, -280):
            c = cq.Workplane("XY", origin=(x, y, 0)).circle(6.35).extrude(FEET)
            f = c if f is None else f.union(c)
    return f


def parts():
    z_cf = chute_z(YF + WT / 2)          # chute surface at front wall
    acr = {"material": "acrylic", "thickness_mm": 3}
    acr6 = {"material": "acrylic", "thickness_mm": 6}
    white, clear = "#f4f2ee", "#cfe8f0"
    access = xz_plate(-XI, XI, PZ, PZ + 110, YB - WT, WT)
    access = access.cut(cq.Workplane("XZ", origin=(25, 0, PZ + 45)).circle(5.6).extrude(-100))
    access = access.cut(cq.Workplane("XZ", origin=(-25, 0, PZ + 45)).circle(8.1).extrude(-100))
    for x in (-XI + 5, XI - 5):
        access = access.cut(cq.Workplane("XZ", origin=(x, 0, PZ + 100)).circle(1.7).extrude(-100))

    def cleat(x0):
        c = cq.Workplane("XY").box(10, 10, 20).translate((x0, YB - WT - 5, PZ + 100))
        return c.cut(cq.Workplane("XZ", origin=(x0, 0, PZ + 100)).circle(2.0).extrude(-(YB - WT - 0.01)).translate((0, 0, 0)))

    return [
        {"name": "Base Plate", "shape": base_plate(), "group": "case", "process": "laser", "params": acr6, "color": white},
        {"name": "Side Panel L", "shape": side_panel(-XI - ST, True), "group": "case", "process": "laser", "params": acr6, "color": white, "explode": [-1, 0, 0]},
        {"name": "Side Panel R", "shape": side_panel(XI, False), "group": "case", "process": "laser", "params": acr6, "color": white, "explode": [1, 0, 0]},
        {"name": "Front Window", "shape": xz_plate(-XI, XI, z_cf + 32, ZTOP, YF, WT), "group": "case", "process": "laser", "params": acr, "color": clear, "explode": [0, -1, 0]},
        {"name": "Front Lower Panel", "shape": xz_plate(-XI, XI, PZ, z_cf - 4.5, YF, WT), "group": "case", "process": "laser", "params": acr, "color": white, "explode": [0, -1, 0]},
        {"name": "Back Panel", "shape": xz_plate(-XI, XI, PZ + 110, ZTOP, YB - WT, WT), "group": "case", "process": "laser", "params": acr, "color": clear, "explode": [0, 1, 0]},
        {"name": "Access Cover", "shape": access, "group": "case", "process": "laser", "params": acr, "color": white, "explode": [0, 1, 0]},
        {"name": "Ramp Front", "shape": ramp(-1), "group": "case", "process": "laser", "params": acr, "color": white},
        {"name": "Ramp Back", "shape": ramp(1), "group": "case", "process": "laser", "params": acr, "color": white},
        {"name": "Chute", "shape": chute(), "group": "case", "process": "laser", "params": acr, "color": white},
        {"name": "Trough", "shape": trough(), "group": "case", "color": "#8a9ba8"},
        {"name": "Portion Wheel", "id": "wheel", "shape": wheel(), "group": "case", "color": "#f2a541"},
        {"name": "Motor Cover", "shape": motor_cover(), "group": "case", "color": "#8a9ba8", "explode": [-1, 0, 0]},
        {"name": "Cover Cleat L", "shape": cleat(-XI + 5), "group": "case", "color": "#8a9ba8"},
        {"name": "Cover Cleat R", "shape": cleat(XI - 5), "group": "case", "color": "#8a9ba8"},
        {"name": "Lid", "shape": rfillet(xz_lid(), "|Z", 10), "group": "case", "process": "laser", "params": acr, "color": white, "explode": [0, 0, 1]},
        {"name": "Lid Plug", "shape": rfillet(cq.Workplane("XY").box(IW - 0.6, YB - YF - 2 * WT - 0.6, WT).translate((0, 0, ZTOP - WT / 2)), "|Z", 2), "group": "case", "process": "laser", "params": acr, "color": white, "explode": [0, 0, 1]},
        {"name": "Steel bowl 16 oz", "shape": bowl(), "group": "component", "color": "#b8bec3"},
        {"name": "Perfboard 50x70", "shape": rfillet(cq.Workplane("XY").box(70, 50, 1.6).translate((0, PCB_Y, PCB_Z + 0.8)), "|Z", 1),
         "group": "component", "color": "#3f7d3a"},
        {"name": "Feed button 16 mm", "shape": cq.Workplane("XZ", origin=(-25, YB, PZ + 45)).circle(9.5).extrude(2)
         .union(cq.Workplane("XZ", origin=(-25, YB - WT, PZ + 45)).circle(8).extrude(-20)), "group": "component", "color": "#d94f3d"},
        {"name": "Rubber foot", "shape": rubber_feet(), "group": "component", "color": "#2b2b2b"},
        part("m3x10_standoff", at=[(x, PCB_Y + y, PZ) for x in (-31, 31) for y in (-21, 21)]),
        part("m3x8_bhcs", at=[(x, PCB_Y + y, PCB_Z + 1.6) for x in (-31, 31) for y in (-21, 21)]),
        part("m3x8_bhcs", at=[(x, PCB_Y + y, PZ - BP_T) for x in (-31, 31) for y in (-21, 21)], rot=(180, 0, 0)),
        part("esp32_c3_supermini", at=(-18, PCB_Y + 8, PCB_Z + 1.6)),
        part("tmc2209", at=(16, PCB_Y + 10, PCB_Z + 1.6 + 2.5)),
        part("mp1584", at=(-18, PCB_Y - 14, PCB_Z + 1.6)),
        part("dc_jack_panel", at=(25, YB, PZ + 45), rot=(-90, 0, 0)),
        part("m3_insert", at=[(x, YB - WT - 6, PZ + 100) for x in (-XI + 5, XI - 5)], rot=(-90, 0, 0)),
        part("m3x8_bhcs", at=[(x, YB, PZ + 100) for x in (-XI + 5, XI - 5)], rot=(-90, 0, 0)),
        part("m3_insert", at=(-XI - ST - 6, 13, 143), rot=(0, -90, 0)),
        part("nema17_40", at=(-XI - ST, 0, ZA), rot=(0, 90, 0)),
        part("m3x10_bhcs", at=[(-XI, dy, ZA + dz) for dy in (-15.5, 15.5) for dz in (-15.5, 15.5)] + [(-XI, 13, 143)], rot=(0, 90, 0)),
    ]


def xz_lid():
    return cq.Workplane("XY").box(IW + 2 * ST + 6, YB - YF + 6, WT).translate((0, 0, ZTOP + WT / 2))


def motion():
    return [{"part": "wheel", "type": "rotate", "axis": [1, 0, 0], "pivot": [0, 0, ZA], "range": [0, 120]}]
