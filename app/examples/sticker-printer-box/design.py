import cadquery as cq
from cadlib import fab
from cadlib.parts import part

# Voice-to-sticker printer: press the button, say an idea, an AI image prints
# on 58 mm thermal sticker paper out of the top.
W, D, H = 122, 100, 88    # case outside (shell, sitting on the base)
WALL = 2.4
R = 16                    # corner radius
BASE_T = 3                # laser-cut plywood base
PY = 14                   # printer centre (Y)
BY = -30                  # button centre (Y)
BTN_HOLE = 24             # 24 mm panel push button
BOSS = [(sx * (W / 2 - 9), sy * (D / 2 - 9)) for sx in (-1, 1) for sy in (-1, 1)]


def case():
    s = (cq.Workplane("XY").box(W, D, H, centered=(True, True, False))
         .edges("|Z").fillet(R))
    try:
        s = s.faces(">Z").edges().fillet(4)
    except Exception:
        pass
    s = s.faces("<Z").shell(-WALL).translate((0, 0, BASE_T))
    # screw bosses for M3 inserts (from below)
    for x, y in BOSS:
        b = (cq.Workplane("XY").circle(4.5).extrude(10)
             .faces(">Z").workplane().hole(0)
             .translate((x, y, BASE_T)))
        s = s.union(b)
        s = s.cut(cq.Workplane("XY").circle(2.0).extrude(6).translate((x, y, BASE_T)))
    top = BASE_T + H
    # printer cut-out, button hole
    s = s.cut(cq.Workplane("XY").box(103.5, 57.5, 20).translate((0, PY, top)))
    s = s.cut(cq.Workplane("XY").circle(BTN_HOLE / 2).extrude(20).translate((0, BY, top - 10)))
    # mic grille on the front: 3 x 5 holes
    for i in range(-2, 3):
        for j in range(-1, 2):
            s = s.cut(cq.Workplane("XZ").circle(1.0).extrude(-10)
                      .translate((i * 4.5, -D / 2 - 2, BASE_T + 55 + j * 4.5)))
    # status LED, USB-C at the back
    s = s.cut(cq.Workplane("XZ").circle(2.6).extrude(-10).translate((0, -D / 2 - 2, BASE_T + 40)))
    s = s.cut(cq.Workplane("XY").box(10, 10, 4.5).translate((0, D / 2, BASE_T + 4.5)))
    return s


def base():
    # fab.panel is already centred on the origin, like the case: same footprint, holes under the bosses
    holes = [(x, y, 3.4) for x, y in BOSS]
    return fab.panel(W, D, BASE_T, r=R, holes=holes)


def printer():
    top = BASE_T + H
    bezel = (cq.Workplane("XY").box(111, 65, 3, centered=(True, True, False))
             .edges("|Z").fillet(3).translate((0, PY, top)))
    slot = cq.Workplane("XY").box(62, 2, 4).translate((0, PY - 18, top + 2))
    body = cq.Workplane("XY").box(103, 57, 55, centered=(True, True, False)).translate((0, PY, top - 55))
    return bezel.union(body).cut(slot)


def parts():
    top = BASE_T + H
    btn = (cq.Workplane("XY").circle(14).extrude(4).translate((0, BY, top))
           .union(cq.Workplane("XY").circle(11).extrude(6).translate((0, BY, top + 4)))
           .union(cq.Workplane("XY").circle(11).extrude(22).translate((0, BY, top - 22))))
    mic = cq.Workplane("XY").box(14, 2, 14).translate((0, -D / 2 + WALL + 1.5, BASE_T + 55))
    pd = cq.Workplane("XY").box(10, 28, 4, centered=(True, True, False)).translate((0, D / 2 - WALL - 14, BASE_T + 2))
    return [
        {"name": "Case", "shape": case(), "group": "case", "color": "#ffd23f", "explode": [0, 0, 1]},
        {"name": "Base", "shape": base(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": 3}, "color": "#d9b382", "explode": [0, 0, -1]},
        {"name": "Thermal printer 58 mm", "shape": printer(), "group": "component", "color": "#2b2b2b",
         "explode": [0, 0, 1]},
        {"name": "Push button 24 mm", "shape": btn, "group": "component", "color": "#ff4d6d",
         "explode": [0, 0, 1]},
        {"name": "INMP441 mic", "shape": mic, "group": "component", "color": "#1f6feb"},
        {"name": "USB-C PD trigger", "shape": pd, "group": "component", "color": "#2d6a4f"},
        part("esp32_s3_devkitc", at=(10, -22, BASE_T + 9)),
        part("mp1584", at=(-30, 10, BASE_T)),
        part("led_5mm", at=(0, -D / 2 + 4, BASE_T + 40), rot=(90, 0, 0)),
        part("m3_insert", at=[(x, y, BASE_T) for x, y in BOSS]),
        part("m3x10_bhcs", at=[(x, y, 0) for x, y in BOSS], rot=(180, 0, 0)),
    ]
