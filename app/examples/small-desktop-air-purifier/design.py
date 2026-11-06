import cadquery as cq
from cadlib.parts import part

# Generic Levoit Core 300-compatible H13 filter: 7.6" OD x 5.8" H, 4.5" bore
FILT_OD, FILT_ID, FILT_H = 193, 114, 147
PLATE_D = 205          # laser-cut plywood base / top plate
PLY = 6
FOOT_H = 3
FAN = 120              # 120 x 120 x 25 fan, M4 holes on 105 mm square
FAN_T = 25
FAN_HOLE = 105
SHR_D = 176            # printed shroud: inner R 86 just clears the fan corners (84.9)
WALL = 2.0
TOP_T = 2.4
GRILLE_R = 58

Z_BASE = FOOT_H
Z_FILT = Z_BASE + PLY                # filter sits on the base disc, inside the ring
Z_PLATE = Z_FILT + FILT_H
Z_FAN = Z_PLATE + PLY
Z_TOP = Z_FAN + FAN_T

SCREW_XY = [(sx * FAN_HOLE / 2, sy * FAN_HOLE / 2) for sx in (-1, 1) for sy in (-1, 1)]


def disc(d, h, z, hole=0):
    w = cq.Workplane("XY").circle(d / 2)
    if hole:
        w = w.circle(hole / 2)
    return w.extrude(h).translate((0, 0, z))


def base():
    b = disc(PLATE_D, PLY, Z_BASE)
    return b


def locator_ring():
    return disc(PLATE_D, PLY, Z_BASE + PLY, hole=FILT_OD + 3)


def top_plate():
    p = disc(PLATE_D, PLY, Z_PLATE, hole=102)
    # M4 clearance; countersink is cut by hand / drill after laser (flush heads on the filter gasket)
    return p.cut(cq.Workplane("XY").pushPoints(SCREW_XY).circle(2.25).extrude(PLY)
                 .translate((0, 0, Z_PLATE)))


def spigot_ring():
    return disc(FILT_ID - 2, PLY, Z_PLATE - PLY, hole=102)


def filter_():
    f = disc(FILT_OD, FILT_H, Z_FILT, hole=FILT_ID)
    cap = disc(FILT_OD, 3, Z_FILT)                      # closed bottom end cap
    return f.union(cap)


def fan():
    frame = (cq.Workplane("XY").rect(FAN, FAN).extrude(FAN_T)
             .edges("|Z").fillet(5)
             .faces(">Z").workplane().circle(58).cutThruAll()
             .faces(">Z").workplane().pushPoints(SCREW_XY).hole(4.3))
    hub = cq.Workplane("XY").circle(20).extrude(FAN_T - 2).translate((0, 0, 1))
    blades = cq.Workplane("XY")
    for i in range(7):
        bl = (cq.Workplane("XY").center(38, 0).rect(36, 2).extrude(FAN_T - 6)
              .translate((0, 0, 3)).rotate((0, 0, 0), (1, 0, 0), 25)
              .rotate((0, 0, 0), (0, 0, 1), i * 360 / 7))
        hub = hub.union(bl)
    return frame.union(hub).translate((0, 0, Z_FAN))


def shroud():
    h = FAN_T + TOP_T
    s = cq.Workplane("XY").circle(SHR_D / 2).extrude(h)
    try:
        s = s.faces(">Z").edges().fillet(6)
    except Exception:
        pass
    s = s.cut(cq.Workplane("XY").circle(SHR_D / 2 - WALL).extrude(FAN_T))
    # concentric grille rings + 6 spokes
    rings = cq.Workplane("XY")
    first = True
    for r in range(12, GRILLE_R + 1, 6):
        ring = cq.Workplane("XY").circle(r).circle(r - 3.5).extrude(TOP_T + 2).translate((0, 0, FAN_T - 1))
        rings = ring if first else rings.union(ring)
        first = False
    for i in range(6):
        spoke = (cq.Workplane("XY").center(GRILLE_R / 2, 0).rect(GRILLE_R + 4, 3)
                 .extrude(TOP_T + 4).translate((0, 0, FAN_T - 2))
                 .rotate((0, 0, 0), (0, 0, 1), i * 60 + 30))
        rings = rings.cut(spoke)
    s = s.cut(rings)
    # fan clamp screw holes
    s = s.cut(cq.Workplane("XY").pushPoints(SCREW_XY).circle(2.25).extrude(h + 1))
    # front: speed knob hole; back: DC jack hole
    knob = (cq.Workplane("XZ").center(0, FAN_T / 2).circle(3.75).extrude(-20)
            .translate((0, -SHR_D / 2 - 5, 0)))
    jack = (cq.Workplane("XZ").center(0, FAN_T / 2).circle(5.6).extrude(20)
            .translate((0, SHR_D / 2 + 5, 0)))
    s = s.cut(knob).cut(jack)
    return s.translate((0, 0, Z_FAN))


def controller():
    # generic 4-pin PWM fan speed controller: board behind the front wall, pot through it
    board = cq.Workplane("XY").box(32, 1.6, 20).translate((0, -SHR_D / 2 + WALL + 12, Z_FAN + FAN_T / 2))
    pot = cq.Workplane("XZ").circle(8).extrude(9).translate((0, -SHR_D / 2 + WALL + 11, Z_FAN + FAN_T / 2))
    shaft = cq.Workplane("XZ").circle(3).extrude(14).translate((0, -SHR_D / 2 + WALL + 2, Z_FAN + FAN_T / 2))
    knob = cq.Workplane("XZ").circle(7).extrude(12).translate((0, -SHR_D / 2 - 1, Z_FAN + FAN_T / 2))
    return board.union(pot).union(shaft), knob


def feet():
    r = PLATE_D / 2 - 18
    pts = [(r * c, r * s) for c, s in ((0.707, 0.707), (-0.707, 0.707), (0.707, -0.707), (-0.707, -0.707))]
    return cq.Workplane("XY").pushPoints(pts).circle(6).extrude(FOOT_H)


def parts():
    ctrl, knob = controller()
    out = [
        {"name": "Base", "shape": base(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": PLY}, "color": "#c8a27a", "explode": [0, 0, -1]},
        {"name": "Filter locator ring", "shape": locator_ring(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": PLY}, "color": "#c8a27a", "explode": [0, 0, -1]},
        {"name": "HEPA filter", "shape": filter_(), "group": "component", "color": "#f2efe6"},
        {"name": "Spigot ring", "shape": spigot_ring(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": PLY}, "color": "#c8a27a", "explode": [0, 0, 1]},
        {"name": "Top plate", "shape": top_plate(), "group": "case", "process": "laser",
         "params": {"material": "plywood", "thickness_mm": PLY}, "color": "#c8a27a", "explode": [0, 0, 1]},
        {"name": "120 mm fan", "id": "fan", "shape": fan(), "group": "component", "color": "#2b2b2b", "explode": [0, 0, 1]},
        {"name": "Fan shroud", "shape": shroud(), "group": "case", "color": "#ecebe7", "explode": [0, 0, 1]},
        {"name": "PWM speed controller", "shape": ctrl, "group": "component", "color": "#1f6f3f"},
        {"name": "Speed knob", "shape": knob, "group": "component", "color": "#3a3a3a"},
        {"name": "Rubber feet", "shape": feet(), "group": "component", "color": "#222222"},
        part("dc_jack_panel", at=(0, SHR_D / 2, Z_FAN + FAN_T / 2), rot=(-90, 0, 0)),
        part("m4x40_csk", at=[(x, y, Z_PLATE) for x, y in SCREW_XY], rot=(180, 0, 0)),
    ]
    return out


def motion():
    return [{"part": "fan", "type": "spin", "axis": [0, 0, 1], "pivot": [0, 0, Z_FAN], "turns": 3}]
