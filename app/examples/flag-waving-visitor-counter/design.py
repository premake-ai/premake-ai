import math
import cadquery as cq
from cadlib.parts import part
from cadlib.refmodels import ref, entry

SCENE = "desk"

# ---- body: open-top box (prints bottom-down, no overhangs) + screwed-on lid --
W, D, H = 74.0, 48.0, 78.0     # outside (X, Y, Z)
T = 3.0                        # wall
R = 8.0                        # vertical corner radius
Z0 = 2.5                       # rubber feet lift everything this much
YF = -D / 2                    # front face
YIN = YF + T                   # inside of the front wall
XIN = W / 2 - T                # inside of the side walls
ZL = H - T                     # body / lid joint plane

# ---- servo: shaft pointing forward (-Y), long axis vertical -------------
COLLAR = 3.0                   # raised collar round the servo, wall + collar = 6 for the tab screws
SV_Z = 50.0                    # servo body centre height
SV_Y = YIN + 18.4              # servo bottom; tab top face rests on the inside of the front wall
SHAFT_Z = SV_Z + 5.5
SV_TAB_DZ = 27.8 / 2
HORN_Y = SV_Y - 29.9           # front of the servo horn

# ---- OLED behind a window, below the servo -----------------------------
OLED_Z = 19.0
OLED_Y = YIN + 0.1 + 2.77      # PCB back face (glass against the wall)
OLED_HW, OLED_HH = 27.3 / 2 + 0.2, 27.9 / 2   # half width / height (+ slip on width)
WIN_Z = OLED_Z - 1.1           # visible glass sits a little below the PCB centre

# ---- your ELEGOO ESP32 DevKit (38-pin, 51.7 x 29, rows 25.6 apart): too wide
# for a breadboard, so it lies upside down (pins up) in a cradle on the floor,
# USB-C out the left wall; jumpers plug straight onto its pins -------------
DK = entry("esp32_devkitc")["size"]          # reference model, 55.4 x 27.9 x 13.2
DK_PL, DK_PW = 56.4, 29.8                    # pocket fits both 55.4 x 27.9 and 51.7 x 29
DK_Y = 2.4
PAD_Z = T + 3.0                              # pad under the board, foam tape on top
DK_TOP = PAD_Z + 1.0 + DK[2]                 # pin tips (board upside down)
DK_PCB = DK_TOP - 8.5                        # PCB pin-side face
RIM_Z = DK_PCB - 2.1                         # rim stops just under the PCB
USB_Z = DK_PCB - 1.6 - 1.6                   # USB-C centre, under the PCB

# ---- mini breadboard as a 5V / GND power strip, on edge against the right wall
BB_L, BB_W, BB_H = 47.0, 35.0, 8.5           # 170-point mini breadboard (SYB-170)
BB_X0 = XIN - BB_H
BB_Y0 = 2.0 - BB_W / 2

BOSS = [(sx * (XIN - 2.75), sy * (D / 2 - T - 2.75)) for sx in (-1, 1) for sy in (-1, 1)]
BOSS_L = 12.0


def lift(s):
    return s.translate((0, 0, Z0))


def ybox(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def ycyl(d, y0, y1, x, z):
    return cq.Workplane("XZ").circle(d / 2).extrude(y1 - y0).translate((x, y1, z))


def zcyl(d, z0, z1, x, y):
    return cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def outer_shell():
    s = cq.Workplane("XY").box(W, D, H, centered=(True, True, False)).edges("|Z").fillet(R)
    return s.edges("not |Z").fillet(T)          # outer fillet = wall, keeps the walls 3 mm


def body_and_lid():
    outer = outer_shell()
    cavity = (cq.Workplane("XY").box(W - 2 * T, D - 2 * T, H, centered=(True, True, False))
              .edges("|Z").fillet(R - T).translate((0, 0, T)))
    top = ybox(-W, W, -D, D, ZL, H + 1)
    body = outer.cut(cavity).cut(top)
    lid = outer.intersect(top)

    # raised collar round the servo
    collar = (cq.Workplane("XZ").center(0, SV_Z).slot2D(44, 26, angle=90).extrude(COLLAR + 1)
              .translate((0, YF + 1, 0)))
    try:
        collar = collar.faces("<Y").edges().fillet(1.5)
    except Exception:
        pass
    body = body.union(collar)
    # servo opening + tab screw pilots (M2, 1.6 mm)
    body = body.cut(ybox(-6.4, 6.4, YF - COLLAR - 1, YIN + 1, SV_Z - 11.7, SV_Z + 11.7))
    for dz in (-SV_TAB_DZ, SV_TAB_DZ):
        body = body.cut(ycyl(1.6, YIN - 5, YIN + 1, 0, SV_Z + dz))

    # OLED window; the module drops into two side channels onto a ledge,
    # glass against the wall, and the servo's lower tab sits just above it
    win = (cq.Workplane("XZ").center(0, WIN_Z).rect(25, 15).extrude(T + 2)
           .edges("|Y").fillet(1.5).translate((0, YF - 1, 0)))
    body = body.cut(win)
    z0, z1 = OLED_Z - OLED_HH, OLED_Z + OLED_HH
    for sx in (-1, 1):
        rail = ybox(OLED_HW + 0.2, OLED_HW + 3, YIN - 1, OLED_Y + 1.7, T - 1, z1)
        lip = ybox(OLED_HW - 1.4, OLED_HW + 3, OLED_Y + 0.2, OLED_Y + 1.7, T - 1, z1)
        if sx < 0:
            rail, lip = rail.mirror("YZ"), lip.mirror("YZ")
        body = body.union(rail).union(lip)
    body = body.union(ybox(-12, 12, YIN - 1, OLED_Y + 0.2, T - 1, z0 - 0.2))

    # ESP32 cradle: pad + 2 mm rim, open at the left wall for the USB end
    x0, x1 = -XIN, -XIN + DK_PL
    y0, y1 = DK_Y - DK_PW / 2, DK_Y + DK_PW / 2
    body = body.union(ybox(x0 - 1, x1 + 2, y0 - 2, y1 + 2, T - 1, RIM_Z))
    body = body.cut(ybox(x0, x1, y0, y1, PAD_Z, RIM_Z + 1))
    usb = (cq.Workplane("YZ").center(DK_Y, USB_Z).slot2D(13, 7.5).extrude(T + 2)
           .translate((-W / 2 - 1, 0, 0)))
    body = body.cut(usb)

    # breadboard stands on the floor against the right wall: low lips hold its foot
    by0, by1 = BB_Y0 - 0.3, BB_Y0 + BB_W + 0.3
    body = body.union(ybox(BB_X0 - 2.3, BB_X0 - 0.3, by0 - 2, by1 + 2, T - 1, T + 4))
    body = body.union(ybox(BB_X0 - 2.3, XIN + 1, by0 - 2, by0, T - 1, T + 4))
    body = body.union(ybox(BB_X0 - 2.3, XIN + 1, by1, by1 + 2, T - 1, T + 4))

    # lid screw bosses in the top corners (M3 self-tap, 2.5 pilot 9 deep),
    # 45 deg cone underneath so they print without support
    for x, y in BOSS:
        boss = zcyl(7.5, ZL - BOSS_L, ZL, x, y).union(
            cq.Workplane("XY").add(cq.Solid.makeCone(0.5, 3.75, 3.25,
                                                     cq.Vector(x, y, ZL - BOSS_L - 3.25))))
        body = body.union(boss).cut(zcyl(2.5, ZL - 9, ZL + 0.1, x, y))
        lid = lid.cut(zcyl(3.4, ZL - 1, H + 1, x, y))
    return body, lid


def breadboard():
    bb = (cq.Workplane("XY").box(BB_H, BB_W, BB_L, centered=False)
          .edges("|X").fillet(1.0)
          .cut(ybox(-1, 1.5, BB_W / 2 - 1.2, BB_W / 2 + 1.2, 1.5, BB_L - 1.5)))
    return bb.translate((BB_X0, BB_Y0, T))


def flag():
    top = SHAFT_Z + 80
    pole = (cq.Workplane("XZ").center(0, (SHAFT_Z - 9 + top) / 2).rect(7, top - SHAFT_Z + 9)
            .extrude(4)
            .union(cq.Workplane("XZ").center(0, SHAFT_Z).circle(9).extrude(4))
            .union(cq.Workplane("XZ").center(0, top).circle(5.5).extrude(4)))
    # wavy flag cloth, flush with the pole's front face
    n, L, h, a = 24, 46.0, 30.0, 2.5
    zt, zb = top - 6, top - 6 - h
    pts = [(2 + L * i / n, zt + a * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    pts += [(2 + L * i / n, zb + a * math.sin(2 * math.pi * i / n)) for i in range(n, -1, -1)]
    cloth = cq.Workplane("XZ").polyline(pts).close().extrude(1.6).translate((0, -2.4, 0))
    f = pole.union(cloth)
    try:
        f = f.edges("|Y").fillet(0.8)
    except Exception:
        pass
    # horn screw clearance + slot for 2 screws into the servo horn arm
    f = f.cut(cq.Workplane("XZ").center(0, SHAFT_Z).circle(2.9).extrude(10, both=True))
    f = f.cut(cq.Workplane("XZ").center(0, SHAFT_Z + 11).slot2D(12, 2.4, angle=90)
              .extrude(10, both=True))
    return f.translate((0, HORN_Y, 0))


def feet():
    s = None
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = cq.Workplane("XY").circle(5).extrude(Z0).translate(
                (sx * (W / 2 - 10), sy * (D / 2 - 9), 0))
            s = c if s is None else s.union(c)
    return s


def parts():
    body, lid = body_and_lid()
    flag_screws = part("m2x6_selftap", rot=(90, 0, 0),
                       at=[(0, HORN_Y - 4, SHAFT_Z + z + Z0) for z in (8, 14)])
    flag_screws["id"] = "flag_screws"
    oled = part("oled_096", at=(0, OLED_Y, OLED_Z + Z0), rot=(90, 0, 0))
    oled["fx"] = {"screen": {"text": "TODAY\n128 visits", "fg": "#ffffff", "bg": "#000000",
                             "face": "-y"}}
    # your ELEGOO ESP32 DevKit, upside down: rotated 180 about X, so `at` is the pin tips
    esp = ref("esp32_devkitc", at=(-XIN + DK[0] / 2, DK_Y, DK_TOP + Z0), rot=(180, 0, 0),
              yours=True)
    esp["name"] = "ESP32 DevKit (yours, ELEGOO)"
    esp["cable"] = {"type": "usb-c", "at": [-W / 2, DK_Y, USB_Z + Z0], "dir": [-1, 0, 0],
                    "length_mm": 500}
    return [
        {"name": "Body", "shape": lift(body), "color": "#f2efe9"},
        {"name": "Lid", "shape": lift(lid), "color": "#f2efe9", "explode": [0, 0, 1]},
        {"name": "Flag", "id": "flag", "shape": lift(flag()), "color": "#ff5a36",
         "explode": [0, -1, 0]},
        {"name": "Rubber feet", "shape": feet(), "group": "component", "color": "#222222",
         "material": "rubber"},
        {"name": "Mini breadboard (170 points)", "shape": lift(breadboard()),
         "group": "component", "color": "#f4f4f0"},
        part("sg90", at=(0, SV_Y, SV_Z + Z0), rot=(90, -90, 0)),
        oled,
        esp,
        part("m3x10_selftap", at=[(x, y, H + Z0) for x, y in BOSS]),
        part("m2x6_selftap", rot=(-90, 0, 0),
             at=[(0, YIN + 2.5, SV_Z + dz + Z0) for dz in (-SV_TAB_DZ, SV_TAB_DZ)]),
        flag_screws,
    ]


def motion():
    ax = {"type": "rotate", "axis": [0, 1, 0], "pivot": [0, 0, SHAFT_Z + Z0],
          "keys": [[0, 0], [0.12, 35], [0.27, -35], [0.42, 35], [0.57, -35], [0.72, 0], [1, 0]]}
    return [dict(ax, part="flag"), dict(ax, part="flag_screws")]


ASSEMBLY = [["Body"], ["Rubber feet"], ["0.96\" OLED display (SSD1306)"],
            ["SG90 micro servo"], ["Mini breadboard (170 points)"],
            ["ESP32 DevKit (yours, ELEGOO)"], ["Lid"], ["Flag"]]
