"""Wi-Fi meat thermometer base for pork: 2.5 mm NTC food probe, OLED, buzzer,
ESP32-C3, 18650 with USB-C charging, magnets for the fridge door."""
import math
import cadquery as cq
from cadlib.parts import part
from cadlib.dims import dim

SCENE = "counter"

L, W = 104.0, 60.0      # footprint
HB = 31.5               # base height (top of walls)
TL = 3.0                # lid thickness
WALL = 2.5
FLOOR = 4.0             # thick enough for flush 10x3 magnet pockets underneath
R = 9.0                 # plan corner radius
BOSS = [(sx * 46.0, sy * 24.0) for sx in (-1, 1) for sy in (-1, 1)]

oled = dim("oled_096_ssd1306")          # holes 23.3 x 23.8, glass 26.7 x 19.27
OX, OY = -22.0, -11.5                   # OLED module centre (header to the back)
OZ = HB - 2.8                           # library model: glass top 2.8 above its origin
GLASS_DY = -1.6                         # glass centre vs board centre (library model)
BX, BY = 14.0, -11.0                    # 12 mm push button
ZX, ZY = 38.0, -10.0                    # 12 mm active buzzer
JY, JZ = -11.0, 14.0                    # 2.5 mm probe jack on the +X wall
TPX, TPY = -35.5, -11.0                 # TP4056 charger (USB-C out the -X wall)
EX, EY = -4.0, -11.0                    # ESP32-C3 SuperMini
HX, HY = 0.0, 16.5                      # 18650 holder 77 x 21 x 19
MAGS = [(sx * 34.0, sy * 17.0) for sx in (-1, 1) for sy in (-1, 1)]


def rbox(x, y, z, w, d, h, r=0):
    b = cq.Workplane("XY").box(w, d, h).translate((x, y, z + h / 2))
    if r:
        b = b.edges("|Z").fillet(r)
    return b


def cyl(x, y, z, d, h):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((x, y, z))


def xcyl(x, y, z, d, h):
    """Cylinder along +X starting at x."""
    return cq.Workplane("YZ").circle(d / 2).extrude(h).translate((x, y, z))


def base():
    b = rbox(0, 0, 0, L, W, HB, R)
    try:
        b = b.faces("<Z").edges().fillet(2.0)
    except Exception:
        pass
    b = b.cut(rbox(0, 0, FLOOR, L - 2 * WALL, W - 2 * WALL, HB, R - WALL))
    # lid screw bosses joined to the corner walls
    for x, y in BOSS:
        b = b.union(cyl(x, y, FLOOR - 1, 7.5, HB - FLOOR + 1))
        b = b.union(rbox(x + math.copysign(2.5, x), y + math.copysign(2.5, y), FLOOR - 1, 5, 5, HB - FLOOR + 1))
        b = b.cut(cyl(x, y, HB - 9, 2.5, 9.01))                       # M3 self-tap pilot
        b = b.cut(cq.Workplane("XY").circle(1.75).workplane(offset=0.5).circle(1.25)
                  .loft().translate((x, y, HB - 0.5)).mirror("XY", (0, 0, HB)))
    # locating rails: charger, ESP32, battery holder (glue or tape on top)
    def frame(x, y, w, d, open_x=None):
        f = rbox(x, y, FLOOR - 1.0, w + 3.0, d + 3.0, 3.0).cut(rbox(x, y, FLOOR - 1, w + 0.6, d + 0.6, 4))
        if open_x is not None:
            f = f.cut(rbox(x + open_x * (w / 2 + 1), y, FLOOR - 1, 4, d - 4, 4))
        return f
    b = b.union(frame(TPX + 0.2, TPY, 28, 17, open_x=-1))
    b = b.union(frame(EX, EY, 22.5, 18))
    b = b.union(frame(HX, HY, 77, 21))
    # USB-C charge port slot (-X wall)
    b = b.cut(rbox(-L / 2, TPY, FLOOR + 1.6, 8, 9.8, 4.0, 1.6))
    # probe jack: 15/64" (5.95 mm) bushing hole, wall thinned to 1.8 mm (max panel 0.075")
    b = b.cut(xcyl(L / 2 - 4, JY, JZ, 6.3, 6))
    b = b.cut(xcyl(L / 2 - WALL - 1, JY, JZ, 12.0, 1.7))
    # magnet pockets from below, 0.8 mm skin
    for x, y in MAGS:
        b = b.cut(cyl(x, y, -0.01, 10.25, 3.2))
    n = len(b.solids().vals())
    if n != 1:
        raise ValueError(f"Base is {n} solids")
    return b


def lid():
    l = rbox(0, 0, HB, L, W, TL, R)
    try:
        l = l.faces(">Z").edges().fillet(2.0)
    except Exception:
        pass
    # OLED: 1.2 mm standoffs down to the PCB, M2 pilots
    hx, hy = oled["hole_spacing_x_mm"] / 2, oled["hole_spacing_y_mm"] / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            l = l.union(cyl(OX + sx * hx, OY + sy * hy, OZ + 1.6, 4.5, HB - OZ - 1.6 + 1.0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            l = l.cut(cyl(OX + sx * hx, OY + sy * hy, OZ + 1.6 - 0.01, 1.6, HB - OZ - 1.6 + 2.2))
    # display window, chamfered
    win = (cq.Workplane("XY").rect(24.0, 15.0).workplane(offset=TL + 0.02).rect(27.0, 18.0)
           .loft().translate((OX, OY + GLASS_DY, HB - 0.01)))
    l = l.cut(win)
    # push button hole
    l = l.cut(cyl(BX, BY, HB - 1, 12.3, TL + 2))
    # buzzer: press-fit ring under the lid, sound holes
    l = l.union(cyl(ZX, ZY, HB - 5, 15.0, 6.0).cut(cyl(ZX, ZY, HB - 6, 12.2, 6)))
    n = len(l.solids().vals())
    if n != 1:
        raise ValueError(f"Lid is {n} solids")
    for i in range(6):
        a = math.radians(60 * i)
        l = l.cut(cyl(ZX + 3.2 * math.cos(a), ZY + 3.2 * math.sin(a), HB - 1, 1.8, TL + 2))
    l = l.cut(cyl(ZX, ZY, HB - 1, 1.8, TL + 2))
    # lid screw clearance + counterbore for pan heads
    for x, y in BOSS:
        l = l.cut(cyl(x, y, HB - 1, 3.4, TL + 2))
        l = l.cut(cyl(x, y, HB + TL - 1.0, 6.6, 2))
    return l


def parts():
    top = HB + TL
    hx, hy = oled["hole_spacing_x_mm"] / 2, oled["hole_spacing_y_mm"] / 2
    probe = (xcyl(-60, -50, 4, 4.0, 150)
             .union(xcyl(90, -50, 4, 12, 30))
             .union(cq.Workplane("XY").sphere(2).translate((-60, -50, 4))))
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": "#2b2d31"},
        {"name": "Lid", "shape": lid(), "group": "case", "color": "#c8452b", "explode": [0, 0, 1]},
        part("esp32_c3_supermini", at=(EX, EY, FLOOR)),
        dict(part("oled_096", at=(OX, OY, OZ)),
             fx={"screen": {"text": "138°F\nPORK > 145", "fg": "#33ccff", "bg": "#000000"}}),
        part("cell_18650", at=(HX, HY, FLOOR + 1.5)),
        {"name": "18650 holder, 1 cell", "shape": rbox(HX, HY, FLOOR, 77, 21, 2).union(
            rbox(HX - 37.5, HY, FLOOR, 2, 21, 19)).union(rbox(HX + 37.5, HY, FLOOR, 2, 21, 19)),
         "group": "component", "color": "#1a1a1a"},
        {"name": "TP4056 USB-C charger", "shape": rbox(TPX, TPY, FLOOR, 28, 17, 1.6).union(
            rbox(TPX - 10.5, TPY, FLOOR + 1.6, 7.5, 9, 3.2)), "group": "component", "color": "#1f4fa8",
         "cable": {"type": "usb-c", "at": [-L / 2, TPY, FLOOR + 3.2], "dir": [-1, 0, 0], "length_mm": 400}},
        {"name": "12 mm push button", "shape": cyl(BX, BY, top, 14, 2).union(cyl(BX, BY, HB - 15, 12, 15 + TL))
            .union(cyl(BX, BY, HB - 2.5, 15.5, 2.5)), "group": "component", "color": "#b8bcc2"},
        {"name": "Active buzzer 3 V, 12 mm", "shape": cyl(ZX, ZY, HB - 9.5, 12, 9.5),
         "group": "component", "color": "#111111"},
        {"name": "2.5 mm stereo panel jack", "shape": xcyl(L / 2 - WALL - 0.7 - 16, JY, JZ, 9, 16)
            .union(xcyl(L / 2 - WALL, JY, JZ, 5.9, WALL + 2.5))
            .union(cq.Workplane("YZ").polygon(6, 9).extrude(2).translate((L / 2, JY, JZ))),
         "group": "component", "color": "#9aa0a6"},
        {"name": "Meat probe, 2.5 mm plug", "shape": probe, "group": "component", "color": "#c9ccd1",
         "material": "steel"},
        part("m2x5_selftap", at=[(OX + sx * hx, OY + sy * hy, OZ) for sx in (-1, 1) for sy in (-1, 1)],
             rot=(180, 0, 0)),
        part("m3x10_selftap", at=[(x, y, top - 1.0) for x, y in BOSS]),
    ]


ASSEMBLY = [["Base"], ["18650 holder, 1 cell", "TP4056 USB-C charger", "ESP32-C3 SuperMini",
            "2.5 mm stereo panel jack"], ["Lid"], ["12 mm push button", "Active buzzer 3 V, 12 mm"]]
