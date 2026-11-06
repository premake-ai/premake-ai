import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part, info
from cadlib.motion import rot, then

SCENE = "desk"

# ---- layout (mm) ----
FOOT_H = 3                       # adhesive rubber feet
DISC_R, DISC_T = 80, 3           # two stainless discs = the weight (~0.95 kg)
HUB_Z0 = FOOT_H + 2 * DISC_T     # 9
HUB_R, HUB_H, HUB_WALL, HUB_TOP = 32, 34, 2.5, 3
HUB_Z1 = HUB_Z0 + HUB_H          # 43
TUBE_D, TUBE_L = 16, 300         # bought aluminium tube, 16 OD x 1 wall
TUBE_Z0 = HUB_Z0 + 6             # sits on a ledge inside the hub
TT = TUBE_Z0 + TUBE_L            # tube top
BORE = 16.3                      # slip fit on the tube
P1 = (0.0, 0.0, TT + 18)         # arm pivot (axis Y)
ARM_L, ARM_A = 230, 25           # pivot to pivot, angle above horizontal
BAR_W, BAR_T, GAP = 20, 3, 12    # flat aluminium bars, gap between them
TONGUE = GAP - 0.4
P2 = (P1[0] + ARM_L * math.cos(math.radians(ARM_A)), 0.0,
      P1[2] + ARM_L * math.sin(math.radians(ARM_A)))
SHADE_D, SHADE_H, SHADE_WALL, SHADE_TOP_T = 96, 45, 2, 2.5
SHADE_TOP = P2[2] - 36
SHADE_Z0 = SHADE_TOP - SHADE_H
HX = P2[0]                       # head centre x
BTN = (0, -19)                   # 12 mm latching button on hub top
PILLARS = [(24 * math.cos(math.radians(a)), 24 * math.sin(math.radians(a))) for a in (0, 135, 225)]
FEET = [(62 * math.cos(math.radians(a)), 62 * math.sin(math.radians(a))) for a in (45, 135, 225, 315)]
DIFF_UP = 5                      # diffuser recessed into the shade
ACR_T = fab.sheet_actual("acrylic", 3)
PLATE_T, PLATE_D = 1.5, 80


def cyl(r, h, x=0, y=0, z=0):
    return cq.Workplane("XY").workplane(offset=z).center(x, y).circle(r).extrude(h)


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def ycyl(r, y0, y1, x, z):
    return cq.Workplane("XZ").workplane(offset=-y1).center(x, z).circle(r).extrude(y1 - y0)


def xcyl(r, x0, x1, y, z):
    return cq.Workplane("YZ").workplane(offset=x0).center(y, z).circle(r).extrude(x1 - x0)


def try_fillet(wp, sel, r):
    try:
        return wp.edges(sel).fillet(r)
    except Exception:
        return wp


def arm_pt(s, y, zl=0.0):
    a = math.radians(ARM_A)
    return (P1[0] + s * math.cos(a) - zl * math.sin(a), y, P1[2] + s * math.sin(a) + zl * math.cos(a))


def arm_place(wp):
    return wp.rotate((0, 0, 0), (0, 1, 0), -ARM_A).translate(P1)


def disc(top):
    d = cyl(DISC_R, DISC_T, z=FOOT_H + (DISC_T if top else 0))
    for (x, y) in PILLARS:
        d = d.cut(cyl(2.25, 20, x, y, z=0))
        if not top:   # countersink from below for flat-head M4
            d = d.cut(cq.Workplane("XY").add(cq.Solid.makeCone(4.3, 2.25, 2.05, cq.Vector(x, y, FOOT_H - 0.001))))
    return try_fillet(d, ">Z" if top else "<Z", 0.8)


def hub():
    outer = cyl(HUB_R, HUB_H, z=HUB_Z0)
    outer = try_fillet(outer, ">Z", 6)
    outer = try_fillet(outer, "<Z", 0.8)
    inner = cyl(HUB_R - HUB_WALL, HUB_H - HUB_TOP, z=HUB_Z0 - 1)
    inner = try_fillet(inner, ">Z", 3.5)
    h = outer.cut(inner.translate((0, 0, 1 - 0.0)).union(cyl(HUB_R - HUB_WALL, 1.01, z=HUB_Z0 - 0.01)))
    # pole socket column hanging from the top, ledge at the bottom with a cable hole
    h = h.union(cyl(10.5, HUB_Z1 - 1 - (TUBE_Z0 - 2), z=TUBE_Z0 - 2))
    h = h.cut(cyl(BORE / 2, HUB_Z1 - TUBE_Z0 + 1, z=TUBE_Z0)).cut(cyl(4.5, 10, z=TUBE_Z0 - 5))
    # set-screw rib (M3 self-tap presses on the tube)
    h = h.union(box(-HUB_R + 1, -9, -5, 5, 26, HUB_Z1 - 1))
    h = h.cut(xcyl(1.25, -HUB_R - 1, 0, 0, 31)).cut(xcyl(3.5, -HUB_R - 1, -27.5, 0, 31))
    h = h.cut(cyl(BORE / 2, HUB_Z1 - TUBE_Z0 + 1, z=TUBE_Z0))
    # pillars for the M4 screws coming up through the steel
    for (x, y) in PILLARS:
        h = h.union(cyl(4.5, HUB_H - 1, x, y, z=HUB_Z0)).cut(cyl(1.65, 13, x, y, z=HUB_Z0 - 1))
    # USB-C cradle + stop lip at the back, port opening in the wall
    h = h.union(box(-9, 9, 13.5, HUB_R - 1.5, HUB_Z0, HUB_Z0 + 3))
    h = h.union(box(-9, 9, 13.5, 15, HUB_Z0 + 3, HUB_Z0 + 5.5))
    h = h.cut(box(-7, 7, HUB_R - 6, HUB_R + 2, PORT_Z - 4.5, PORT_Z + 4.5))
    # button hole
    h = h.cut(cyl(6.1, 10, BTN[0], BTN[1], z=HUB_Z1 - 6))
    return h


PORT_Z = HUB_Z0 + 3 + 3.2


def pole_cap():
    c = cyl(12, 29, z=TT - 25)
    c = try_fillet(c, "<Z", 1.5)
    tongue = (box(-12, 12, -TONGUE / 2, TONGUE / 2, TT + 3, P1[2])
              .union(ycyl(12, -TONGUE / 2, TONGUE / 2, 0, P1[2])))
    c = c.union(tongue)
    c = c.cut(cyl(BORE / 2, 25, z=TT - 25))
    c = c.cut(ycyl(2.75, -20, 20, 0, P1[2]))
    c = c.cut(box(6, 14, -3, 3, TT - 8, TT + 4))       # cable exit slot
    return c


def arm_bar(y0):
    b = (cq.Workplane("XZ").center(ARM_L / 2, 0).slot2D(ARM_L + BAR_W, BAR_W).extrude(-BAR_T)
         .translate((0, y0, 0)))
    for s in (0, ARM_L):
        b = b.cut(ycyl(2.75, -20, 20, s, 0))
    for s in (ARM_L / 3, 2 * ARM_L / 3):
        b = b.cut(ycyl(1.7, -20, 20, s, -3))
    return arm_place(b)


def spacer(s):
    sp = ycyl(4.5, -GAP / 2, GAP / 2, s, -3).cut(ycyl(1.7, -20, 20, s, -3))
    return arm_place(sp)


def shade():
    o = cyl(SHADE_D / 2, SHADE_H, HX, 0, SHADE_Z0)
    o = try_fillet(o, ">Z", 8)
    o = try_fillet(o, "<Z", 0.8)
    ri = SHADE_D / 2 - SHADE_WALL
    i = cyl(ri, SHADE_H - SHADE_TOP_T + 1, HX, 0, SHADE_Z0 - 1)
    i = try_fillet(i, ">Z", 6)
    s = o.cut(i)
    # tab up to the head pivot, between the arm bars
    tab = (box(HX - 10, HX + 10, -TONGUE / 2, TONGUE / 2, SHADE_TOP - 4, P2[2])
           .union(ycyl(10, -TONGUE / 2, TONGUE / 2, HX, P2[2])))
    s = s.union(tab).cut(ycyl(2.75, -20, 20, HX, P2[2]))
    # diffuser bosses (on short ribs to the wall) and LED plate bosses on the ceiling
    for k in range(3):
        a = math.radians(90 + 120 * k)
        x, y = HX + 41 * math.cos(a), 41 * math.sin(a)
        b = cyl(4, 12, x, y, SHADE_Z0 + DIFF_UP)
        rib = (cq.Workplane("XY").box(6, 4, 12).translate((44, 0, SHADE_Z0 + DIFF_UP + 6))
               .rotate((0, 0, 0), (0, 0, 1), 90 + 120 * k).translate((HX, 0, 0)))
        s = s.union(b).union(rib).cut(cyl(1.25, 9, x, y, SHADE_Z0 + DIFF_UP - 1))
        a2 = math.radians(30 + 120 * k)
        x2, y2 = HX + 33 * math.cos(a2), 33 * math.sin(a2)
        s = s.union(cyl(4, 8, x2, y2, SHADE_TOP - SHADE_TOP_T - 7)).cut(cyl(1.25, 8, x2, y2, PLATE_TOP - 0.5))
    s = s.cut(cyl(2.75, 10, HX - 16, 0, SHADE_TOP - 6))   # cable entry
    return s


PLATE_TOP = SHADE_TOP - SHADE_TOP_T - 7


def led_plate():
    p = cyl(PLATE_D / 2, PLATE_T, HX, 0, PLATE_TOP - PLATE_T)
    for k in range(3):
        a = math.radians(30 + 120 * k)
        p = p.cut(cyl(1.7, 5, HX + 33 * math.cos(a), 33 * math.sin(a), PLATE_TOP - 3))
    return p


ROWS = [-24, -12, 0, 12, 24]


def led_strip():
    z1 = PLATE_TOP - PLATE_T
    s = None
    for y in ROWS:
        L = 2 * math.sqrt(37 ** 2 - y ** 2)
        r = box(HX - L / 2, HX + L / 2, y - 4, y + 4, z1 - 1.5, z1)
        s = r if s is None else s.union(r)
    return s


def diffuser():
    zt = SHADE_Z0 + DIFF_UP
    d = cyl(SHADE_D / 2 - SHADE_WALL - 0.2, ACR_T, HX, 0, zt - ACR_T)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        d = d.cut(cyl(1.7, 10, HX + 41 * math.cos(a), 41 * math.sin(a), zt - 5))
    return d


def button():
    return cyl(6.5, 2, BTN[0], BTN[1], HUB_Z1).union(cyl(6, 20, BTN[0], BTN[1], HUB_Z1 - 20))


def feet():
    s = None
    for (x, y) in FEET:
        f = cyl(6.35, FOOT_H, x, y, 0)
        s = f if s is None else s.union(f)
    return s


def parts():
    zs = HUB_Z0 + 3     # USB board sits on the cradle
    hd = DIFF_UP + SHADE_Z0
    out = [
        {"name": "Base disc (bottom)", "id": "disc_bottom", "shape": disc(False), "process": "sheet",
         "params": {"material": "stainless 304", "thickness_mm": DISC_T, "bends": 0}, "explode": [0, 0, -1]},
        {"name": "Base disc (top)", "id": "disc_top", "shape": disc(True), "process": "sheet",
         "params": {"material": "stainless 304", "thickness_mm": DISC_T, "bends": 0}, "explode": [0, 0, -0.5]},
        {"name": "Hub", "id": "hub", "shape": hub(), "color": "#2a2a2c"},
        {"name": "16 mm aluminium tube 300 mm", "shape": cyl(8, TUBE_L, z=TUBE_Z0).cut(cyl(7, TUBE_L, z=TUBE_Z0)),
         "group": "component", "material": "aluminium"},
        {"name": "Pole cap", "id": "cap", "shape": pole_cap(), "color": "#2a2a2c"},
        {"name": "Arm bar (left)", "id": "bar_l", "shape": arm_bar(-GAP / 2), "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": BAR_T, "bends": 0}},
        {"name": "Arm bar (right)", "id": "bar_r", "shape": arm_bar(GAP / 2 + BAR_T), "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": BAR_T, "bends": 0}},
        {"name": "Arm spacer 1", "id": "sp1", "shape": spacer(ARM_L / 3), "color": "#2a2a2c"},
        {"name": "Arm spacer 2", "id": "sp2", "shape": spacer(2 * ARM_L / 3), "color": "#2a2a2c"},
        {"name": "Shade", "id": "shade", "shape": shade(), "color": "#2a2a2c"},
        {"name": "LED plate", "id": "plate", "shape": led_plate(), "process": "sheet",
         "params": {"material": "aluminium 5052", "thickness_mm": PLATE_T, "bends": 0}},
        {"name": "5V COB LED strip", "id": "leds", "shape": led_strip(), "group": "component", "color": "#f2e6c8",
         "fx": {"glow": {"color": "#ffd9a0"}}},
        {"name": "Diffuser", "id": "diffuser", "shape": diffuser(), "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "material": "acrylic_frosted",
         "fx": {"glow": {"color": "#fff1dc"}}},
        {"name": "12 mm latching push button", "shape": button(), "group": "component", "color": "#b8b8b8"},
        {"name": "Adhesive rubber foot", "shape": feet(), "group": "component", "material": "rubber"},
        part("usbc_breakout", at=(0, HUB_R - 1.5 - 7, zs), rot=(0, 0, -90)),
        part("m4x16_csk", at=[(x, y, FOOT_H) for (x, y) in PILLARS], rot=(180, 0, 0)),
        part("m3x20_selftap", at=(-27.5, 0, 31), rot=(0, -90, 0)),
        # friction pivots: M5 bolt, washers, nylock at the pole cap and the head
        part("m5x25_shcs", at=[(P1[0], -GAP / 2 - BAR_T - 1, P1[2]), (P2[0], -GAP / 2 - BAR_T - 1, P2[2])], rot=(90, 0, 0)),
        part("m5_washer", at=[(P1[0], -GAP / 2 - BAR_T - 1, P1[2]), (P2[0], -GAP / 2 - BAR_T - 1, P2[2]),
                              (P1[0], GAP / 2 + BAR_T, P1[2]), (P2[0], GAP / 2 + BAR_T, P2[2])], rot=(-90, 0, 0)),
        part("m5_nylock", at=[(P1[0], GAP / 2 + BAR_T + 1, P1[2]), (P2[0], GAP / 2 + BAR_T + 1, P2[2])], rot=(-90, 0, 0)),
        part("m3x20_shcs", at=[arm_pt(s, -GAP / 2 - BAR_T, -3) for s in (ARM_L / 3, 2 * ARM_L / 3)], rot=(90, -ARM_A, 0)),
        part("m3_nylock", at=[arm_pt(s, GAP / 2 + BAR_T, -3) for s in (ARM_L / 3, 2 * ARM_L / 3)], rot=(-90, -ARM_A, 0)),
        part("m3x10_selftap", at=[(HX + 41 * math.cos(math.radians(90 + 120 * k)), 41 * math.sin(math.radians(90 + 120 * k)),
                                   hd - ACR_T) for k in range(3)], rot=(180, 0, 0)),
        part("m3x8_selftap", at=[(HX + 33 * math.cos(math.radians(30 + 120 * k)), 33 * math.sin(math.radians(30 + 120 * k)),
                                  PLATE_TOP - PLATE_T) for k in range(3)], rot=(180, 0, 0)),
    ]
    return out


ASSEMBLY = [["Base disc (bottom)", "Base disc (top)"], ["Hub", "USB-C power breakout", "12 mm latching push button"],
            ["16 mm aluminium tube 300 mm"], ["Pole cap"], ["LED plate", "5V COB LED strip"], ["Diffuser"],
            ["Shade"], ["Arm bar (left)", "Arm bar (right)", "Arm spacer 1", "Arm spacer 2"], ["Adhesive rubber foot"]]


ARM_HW = ["bar_l", "bar_r", "sp1", "sp2", "m3-20-socket-head-screw-2", "m3-nylock-nut-2",
          "m5-25-socket-head-screw-2", "m5-washer-4", "m5-nylock-nut-2"]   # M5 parts are coaxial with both pivots
HEAD = ["shade", "plate", "leds", "diffuser", "m3-10-self-tapping-screw-for-plastic-3",
        "m3-8-self-tapping-screw-for-plastic-3"]


def motion():
    def pose(t):
        sw = rot((0, 0, 1), 35 * math.sin(2 * math.pi * t))
        arm = then(rot((0, 1, 0), -14 * math.sin(2 * math.pi * t), P1), sw)
        head = then(rot((0, 1, 0), -22 * math.sin(math.pi * t) ** 2, P2), arm)
        out = {"cap": sw}
        for k in ARM_HW:
            out[k] = arm
        for k in HEAD:
            out[k] = head
        return out
    return {"duration": 7, "pose": pose}
