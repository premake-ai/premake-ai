import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part
from cadlib.motion import move, rot

# Motorized camera slider: 600 mm 2040 V-slot rail lying flat, V-wheel carriage on top,
# GT2 belt running under the rail, NEMA17 at the left end, tensioning idler at the right.
L = 600          # rail length (stock 2040 length)
RZ = 40          # rail bottom height above the table
X0 = -L / 2
FT = 8         # end foot plate thickness
PZ = RZ - 14     # pulley / idler axis height
MX = X0 - 32     # motor / pulley axis x
IX = -X0 + 24    # idler axis x (+-5 mm tension slot)
WX, WY = 35, 29.65   # wheel centres (V-slot wheel centre 9.65 mm off the rail face)
TRAVEL = 240     # carriage travel each side of centre in the demo motion
NUT_AF = 11.3    # 1/4"-20 hex nut across flats + clearance


def B(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def hex_pocket(x, y, z0, depth):
    return (cq.Workplane("XY").polygon(6, NUT_AF / math.cos(math.radians(30)))
            .extrude(depth).translate((x, y, z0)))


def foot_plate(x0):
    """Upright end plate the rail bolts onto: belt window, rail bolt counterbores, 1/4"-20 tripod nut."""
    left = x0 < 0                                                       # motor end: inner face is +X
    p = B(x0, x0 + FT, -40, 40, 0, RZ + 18)
    try:
        p = p.edges("|X").fillet(6)
    except Exception:
        pass
    boss = B(x0 - 3, x0 + FT + 3, -13, 13, 0, 12)                       # thick pad for the tripod nut
    try:
        boss = boss.edges("|Z").fillet(3)
    except Exception:
        pass
    p = p.union(boss)
    p = p.cut(B(x0 - 1, x0 + FT + 1, -6, 6, RZ - 24, RZ - 3))           # belt window
    for s in (-1, 1):                                                   # lightening windows
        w = cq.Workplane("YZ").center(s * 29, 31).rect(12, 42).extrude(FT + 2).translate((x0 - 1, 0, 0))
        try:
            w = w.edges("|X").fillet(5)
        except Exception:
            pass
        p = p.cut(w)
    outer = x0 if left else x0 + FT
    for y in (-10, 10):                                                 # M5 into the rail end taps
        p = p.cut(cq.Workplane("YZ").circle(2.75).extrude(FT + 2).translate((x0 - 1, y, RZ + 10)))
        p = p.cut(cq.Workplane("YZ").circle(4.9).extrude(4).translate((outer if left else outer - 4, y, RZ + 10)))
    xc = x0 + FT / 2                                                    # 1/4"-20 tripod nut, slid in from inside
    p = p.cut(cq.Workplane("XY").circle(3.4).extrude(5).translate((xc, 0, -0.5)))
    p = p.cut(hex_pocket(xc, 0, 4, 6.2))
    p = p.cut(B(xc, x0 + FT + 4, -NUT_AF / 2, NUT_AF / 2, 4, 10.2) if left
              else B(x0 - 4, xc, -NUT_AF / 2, NUT_AF / 2, 4, 10.2))
    return p


def motor_end():
    fx = X0 - FT
    p = foot_plate(fx)
    wall = B(X0 - 60, fx + 1, -17, -12, 0, 52)                          # motor mount wall
    try:
        wall = wall.edges("|Y").fillet(4)
    except Exception:
        pass
    box = B(X0 - 60, fx + 1, -17, 50, 0, 30)                            # base + control box
    try:
        box = box.edges("|Z").fillet(4)
    except Exception:
        pass
    p = p.union(wall).union(box)
    p = p.cut(B(X0 - 58, fx, 12, 48, 2.5, 40))                          # control box cavity
    p = p.cut(B(X0 - 58, fx, -12, 10, 2.5, 40))                         # open bay for the pulley
    p = p.cut(cq.Workplane("XZ").circle(11.5).extrude(-8).translate((MX, -18, PZ)))  # motor boss
    for dx in (-15.5, 15.5):
        for dz in (-15.5, 15.5):
            p = p.cut(cq.Workplane("XZ").circle(1.7).extrude(-8).translate((MX + dx, -18, PZ + dz)))
    p = p.cut(cq.Workplane("XZ").circle(5.5).extrude(-5).translate((X0 - 30, 49, 17)))      # DC jack 11 mm
    p = p.cut(B(X0 - 61, X0 - 56, 17, 27, 3, 9))                        # USB-C access for flashing
    p = p.cut(B(X0 - 54, X0 - 46, 9, 14, 2.5, 12))                    # motor + switch cable notch
    p = p.union(B(X0 - 1, X0 + 30, -32, -22, RZ - 14, RZ - 6))          # limit switch arm
    return p


def control_lid():
    lid = B(X0 - 60, X0 - FT, 10, 50, 30, 32.5)
    try:
        lid = lid.edges("|Z").fillet(4).faces(">Z").edges().fillet(1)
    except Exception:
        pass
    lip = B(X0 - 57.8, X0 - FT - 0.2, 12.2, 47.8, 27, 30.5)             # friction lip inside the box
    lip = lip.cut(B(X0 - 56, X0 - FT - 2, 14, 46, 26, 30))
    lid = lid.union(lip)
    for i in range(5):                                                  # vent slots over the driver
        x = X0 - 52 + i * 6
        lid = lid.cut(B(x, x + 2.5, 30, 44, 29, 34))
    return lid


def idler_end():
    ix = -X0
    p = foot_plate(ix)
    ch = (B(ix + FT - 1, IX + 11, -11, 11, 0, RZ - 6))
    ch = ch.cut(B(ix + FT, IX + 12, -6, 6, 3, RZ))                   # two cheeks + base
    try:
        ch = ch.edges("|Y").fillet(3)
    except Exception:
        pass
    p = p.union(ch)
    slot = (cq.Workplane("XZ").slot2D(15.5, 5.5).extrude(15)
            .translate((ix + 34, 15, PZ)))                              # +-5 mm belt tension slot
    p = p.cut(slot).cut(slot.mirror("XZ"))
    return p


def carriage():
    plate = (cq.Workplane("XY").rect(96, 76).extrude(6).translate((0, 0, RZ + 22)))
    try:
        plate = plate.edges("|Z").fillet(8).faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    for sx in (-1, 1):                                                  # weight-saving windows
        w = cq.Workplane("XY").center(sx * 31, 0).rect(18, 42).extrude(10).translate((0, 0, RZ + 20))
        try:
            w = w.edges("|Z").fillet(4)
        except Exception:
            pass
        plate = plate.cut(w)
    arm = B(-12, 12, -26, -21, RZ - 12, RZ + 23)                        # drops past the rail side
    tongue = B(-12, 12, -26, 7, RZ - 12, RZ - 1.5)                     # under the rail, holds the belt
    boss = cq.Workplane("XY").circle(11).extrude(5).translate((0, 0, RZ + 27))   # camera stud boss
    try:
        boss = boss.faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    c = plate.union(boss).union(arm).union(tongue)
    try:
        c = c.edges("|Y").edges("<Z").fillet(2)
    except Exception:
        pass
    c = c.cut(B(-16, 16, -3.6, 3.6, RZ - 8.6, RZ - 6.6))                # belt clamp slot
    c = c.cut(B(-5, 5, -8, 8, RZ - 10, RZ - 8.5))                       # zip-tie window
    for x in (-WX, WX):
        c = c.cut(cq.Workplane("XY").circle(2.75).extrude(12).translate((x, WY, RZ + 20)))
        c = c.cut(cq.Workplane("XY").circle(3.6).extrude(12).translate((x, -WY, RZ + 20)))  # eccentric spacers
    c = c.cut(hex_pocket(0, 0, RZ + 21, 7.2))                           # 1/4"-20 nut for the camera stud
    c = c.cut(cq.Workplane("XY").circle(3.4).extrude(12).translate((0, 0, RZ + 21)))
    if len(c.solids().vals()) != 1:
        raise ValueError("carriage is not one solid")
    return c


def v_wheel(x, y):
    w = (cq.Workplane("XZ").polyline([(2.5, 0), (9.8, 0), (11.9, 5.5), (9.8, 11), (2.5, 11)]).close()
         .revolve(360, (0, 0, 0), (0, 1, 0)).translate((x, y, RZ + 4.5)))
    spacer = cq.Workplane("XY").circle(5).extrude(6.5).translate((x, y, RZ + 15.5))
    return w.union(spacer)


def wheels():
    s = None
    for x in (-WX, WX):
        for y in (-WY, WY):
            w = v_wheel(x, y)
            s = w if s is None else s.union(w)
    return s


def belt():
    top = B(MX, IX, -3, 3, RZ - 8.3, RZ - 6.9)
    bot = B(MX, IX, -3, 3, RZ - 21.1, RZ - 19.7)
    return top.union(bot)


def idler():
    hub = cq.Workplane("XZ").circle(6.1).extrude(4.5, both=True)
    fl = cq.Workplane("XZ").circle(9).extrude(0.6, both=True)
    i = hub.union(fl.translate((0, 4.2, 0))).union(fl.translate((0, -4.2, 0)))
    return i.translate((IX, 0, PZ))


def camera_stud():
    return cq.Workplane("XY").circle(3.17).extrude(20).translate((0, 0, RZ + 22))


def limit_switch():
    return B(X0 + 30, X0 + 36.5, -32, -22, RZ - 16, RZ + 4)


def mv(d, i):
    d["id"] = i
    return d


def parts():
    rail = fab.extrusion(L, profile="2040", axis="x", at=(X0, 0, RZ + 10))
    return [
        {"name": "Rail", "shape": rail, "group": "case", "process": "extrusion",
         "params": {"profile": "2040", "length_mm": L, "tapped_ends": 2}, "color": "#c4c8ce"},
        {"name": "Motor End", "shape": motor_end(), "group": "case", "color": "#2b2d31", "explode": [-1, 0, 0]},
        {"name": "Control Box Lid", "shape": control_lid(), "group": "case", "color": "#e0662b", "explode": [0, 0, 1]},
        {"name": "Idler End", "shape": idler_end(), "group": "case", "color": "#2b2d31", "explode": [1, 0, 0]},
        {"name": "Carriage", "id": "Carriage", "shape": carriage(), "group": "case", "color": "#e0662b",
         "explode": [0, 0, 1]},
        {"name": "V-slot wheel kit", "id": "Wheels", "shape": wheels(), "group": "component", "color": "#1d1d1f"},
        {"name": "GT2 belt 6 mm", "shape": belt(), "group": "component", "color": "#222222"},
        {"name": "GT2 idler 20T 5 mm bore", "shape": idler(), "group": "component", "color": "#9aa0a6"},
        {"name": "1/4\"-20 camera stud", "id": "Stud", "shape": camera_stud(), "group": "component",
         "color": "#9aa0a6"},
        {"name": "Limit switch", "shape": limit_switch(), "group": "component", "color": "#2a62c9"},
        part("nema17_40", at=(MX, -17, PZ), rot=(-90, 0, 0)),
        mv(part("gt2_pulley_20t", at=(MX, -8, PZ), rot=(-90, 0, 0)), "Pulley"),
        part("m3x10_shcs", at=[(MX + dx, -12, PZ + dz) for dx in (-15.5, 15.5) for dz in (-15.5, 15.5)],
             rot=(-90, 0, 0)),
        part("m5x16_shcs", at=[(X0 - FT + 4, y, RZ + 10) for y in (-10, 10)], rot=(0, -90, 0)),
        part("m5x16_shcs", at=[(-X0 + FT - 4, y, RZ + 10) for y in (-10, 10)], rot=(0, 90, 0)),
        part("m5x30_shcs", at=(IX, 11, PZ), rot=(-90, 0, 0)),
        part("m5_nylock", at=(IX, -11, PZ), rot=(90, 0, 0)),
        mv(part("m5x35_shcs", at=[(x, y, RZ + 28) for x in (-WX, WX) for y in (-WY, WY)]), "WheelScrews"),
        mv(part("m5_nylock", at=[(x, y, RZ - 0.5) for x in (-WX, WX) for y in (-WY, WY)]), "WheelNuts"),
        part("esp32_c3_supermini", at=(X0 - 45, 22, 2.5)),
        part("tmc2209", at=(X0 - 45, 39, 11.5)),
        part("mp1584", at=(X0 - 20, 22, 2.5)),
        part("dc_jack_panel", at=(X0 - 30, 50, 17), rot=(-90, 0, 0)),
    ]


def motion():
    def pose(t):
        x = TRAVEL * math.sin(2 * math.pi * t)
        m = move((x, 0, 0))
        return {"Carriage": m, "Wheels": m, "Stud": m, "WheelScrews": m, "WheelNuts": m,
                "Pulley": rot((0, 1, 0), -x / 40 * 360, (MX, 0, PZ))}
    return {"duration": 8, "pose": pose}
