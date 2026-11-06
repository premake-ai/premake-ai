import cadquery as cq
from cadlib.parts import part, info

NAME = "NAME"

FOOT = 3.5             # rubber bumper height
L, W, H = 220, 45, 26  # printed base
WALL = 3
PLATE_T = 3
Z0 = FOOT + PLATE_T    # base bottom
CAV_TOP = Z0 + 10      # electronics cavity
CH_Z = CAV_TOP + 2     # LED channel floor (2 mm floor)
AC_T, AC_W, AC_H = 6, 200, 110
SLOT_D = 12
SLOT_Z = Z0 + H - SLOT_D   # acrylic bottom edge
N_LED = 12
STRIP_L = N_LED * 1000 / 60 + 0.5
SCREWS = [(sx * 100, sy * 14) for sx in (-1, 1) for sy in (-1, 1)]
C3 = info("esp32_c3_supermini")["dims"]
C3_X = -L / 2 + WALL + C3[0] / 2 - 1.5   # USB-C pokes into the end wall
C3_Y = 5                                  # clear of the screw bosses


def base():
    b = (cq.Workplane("XY").box(L, W, H, centered=(True, True, False))
         .edges("|Z").fillet(10))
    try:
        b = b.faces(">Z").edges().fillet(3)
    except Exception:
        pass
    b = b.translate((0, 0, Z0))
    # electronics cavity, open at the bottom
    cav = (cq.Workplane("XY").box(L - 2 * WALL, W - 2 * WALL, CAV_TOP - Z0, centered=(True, True, False))
           .edges("|Z").fillet(7).translate((0, 0, Z0)))
    b = b.cut(cav)
    # side pockets either side of the slot to save plastic (3 mm top skin)
    for sy in (-1, 1):
        y0, y1 = 5.5 + 2.4, W / 2 - WALL
        pk = (cq.Workplane("XY").box(L - 2 * WALL - 8, y1 - y0, H - 3 - 0.5, centered=(True, False, False))
              .edges("|Z").fillet(2).translate((0, y0 if sy > 0 else -y1, Z0)))
        b = b.cut(pk)
    # screw bosses with M3 self-tap pilot holes
    for x, y in SCREWS:
        boss = cq.Workplane("XY").circle(4).extrude(H - 2).translate((x, y, Z0))
        b = b.union(boss)
        b = b.cut(cq.Workplane("XY").circle(1.35).extrude(9).translate((x, y, Z0)))
    # clamp ribs pressing the controller board onto the plate
    for ry in (0, 6):
        rib = cq.Workplane("XY").box(3, 3, CAV_TOP - Z0 - 1.6 + 1, centered=(True, True, False)) \
            .translate((C3_X + C3[0] / 2 - 2, ry, Z0 + 1.6))
        b = b.union(rib)
    # LED strip channel and acrylic slot
    b = b.cut(cq.Workplane("XY").box(STRIP_L + 4, 11, SLOT_Z - CH_Z + 1, centered=(True, True, False))
              .translate((0, 0, CH_Z)))
    b = b.cut(cq.Workplane("XY").box(AC_W + 0.6, AC_T + 0.3, SLOT_D + 1, centered=(True, True, False))
              .translate((0, 0, SLOT_Z)))
    # wire hole from strip channel down into the cavity
    b = b.cut(cq.Workplane("XY").circle(3).extrude(4).translate((-STRIP_L / 2 + 4, 0, CAV_TOP - 1)))
    # USB-C opening in the left end wall
    usb = (cq.Workplane("YZ").rect(10, 4.5).extrude(10)
           .edges("|X").fillet(1.5).translate((-L / 2 - 2, C3_Y, Z0 + 1.6 + 1.6)))
    b = b.cut(usb)
    n = len(b.solids().vals())
    if n != 1:
        raise RuntimeError(f"base is {n} solids")
    return b


def acrylic():
    a = (cq.Workplane("XZ").rect(AC_W, AC_H).extrude(AC_T / 2, both=True)
         .edges("|Y").fillet(8).translate((0, 0, SLOT_Z + AC_H / 2)))
    size = min(48, 170 / (0.68 * max(len(NAME), 1)))
    txt = (cq.Workplane("XZ", origin=(0, -AC_T / 2 + 0.6, SLOT_Z + AC_H / 2 + 6))
           .text(NAME, size, -2, kind="bold", halign="center", valign="center"))
    out = a.cut(txt)
    if out.val().Volume() >= a.val().Volume() - 1:
        raise RuntimeError("name engraving failed")
    return out


def plate():
    p = (cq.Workplane("XY").box(L, W, PLATE_T, centered=(True, True, False))
         .edges("|Z").fillet(10))
    for x, y in SCREWS:
        p = p.cut(cq.Workplane("XY").circle(1.7).extrude(PLATE_T).translate((x, y, 0)))
        p = p.cut(cq.Workplane("XY").circle(1.7).workplane(offset=1.7).circle(3.3)
                  .loft().translate((x, y, 0)))
    return p.translate((0, 0, FOOT))


def feet():
    return (cq.Workplane("XY").pushPoints([(sx * 90, sy * 12) for sx in (-1, 1) for sy in (-1, 1)])
            .circle(6).extrude(FOOT))


def parts():
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": "#222222", "explode": [0, 0, 1]},
        {"name": "Sign panel", "shape": acrylic(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 6}, "color": "#cfe8ff", "explode": [0, 0, 1]},
        {"name": "Bottom plate", "shape": plate(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#111111", "explode": [0, 0, -1]},
        part("ws2812_strip", length=STRIP_L, at=(-STRIP_L / 2, 0, CH_Z)),
        part("esp32_c3_supermini", at=(C3_X, C3_Y, Z0)),
        part("m3x8_csk", at=[(x, y, FOOT) for x, y in SCREWS], rot=(180, 0, 0)),
        {"name": "Rubber bumper 12 mm", "shape": feet(), "group": "component", "color": "#333333"},
    ]
