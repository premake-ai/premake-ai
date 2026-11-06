import math
import cadquery as cq
from cadlib.parts import part

# Radial HEPA cartridge (LV-H132 type): air in through the side, out the centre hole
FIL_D, FIL_H = 190.5, 62.0
FIL_ID = 100.0             # centre hole
W = 2.0                    # printed wall thickness
ID = 200.0                 # bore: ~5 mm intake gap round the filter
OD = ID + 2 * W
R_IN, R_OUT = ID / 2, OD / 2
T = 3.0                    # laser-cut acrylic discs
DISC_D = ID - 0.6          # discs drop into the bore
LIP_T, LIP_W = 2.0, 6.0    # body's bottom flange the floor disc rests on
FIL_Z = LIP_T + T          # filter stands on the floor disc
DECK_Z = FIL_Z + FIL_H     # deck disc lies on the filter's top end cap
BODY_H = DECK_Z + T + 4    # 4 mm of bore above the deck for the cap spigot
FAN = 120.0
FAN_T = 25.0
FAN_HOLE = 105.0
FAN_Z = DECK_Z + T + 8     # 8 mm plenum: nuts + screw tails clear the deck
TOP_Z = FAN_Z + FAN_T      # top grille disc underside
CAP_TOP = TOP_Z + T
FOOT_H = 8.0
DZ = FOOT_H - LIP_T        # feet stick to the floor disc, below the flange
UI_Z = BODY_H + 12         # front controls / rear jack height
CTRL_A = 13.0              # button / knob angle either side of front


def hex_grid(pitch, r_min, r_max):
    pts = []
    n = int(r_max / pitch) + 2
    for j in range(-n, n + 1):
        for i in range(-n, n + 1):
            x = i * pitch + (pitch / 2 if j % 2 else 0)
            y = j * pitch * 0.866
            if r_min < math.hypot(x, y) < r_max:
                pts.append((x, y))
    return pts


def revolve(profile):
    return cq.Workplane("XZ").polyline(profile).close().revolve(360, (0, 0, 0), (0, 1, 0))


def radial(shape_along_x, ang):
    return shape_along_x.rotate((0, 0, 0), (0, 0, 1), ang)


def wall_hole(ang, z, d):
    h = cq.Workplane("YZ").workplane(offset=R_OUT - 6).center(0, z).circle(d / 2).extrude(12)
    return radial(h, ang)


def body():
    # thin printed ring with a bottom flange; one revolved solid
    b = revolve([(R_IN - LIP_W, 0), (R_OUT - 1, 0), (R_OUT, 1), (R_OUT, BODY_H - 0.6),
                 (R_OUT - 0.6, BODY_H), (R_IN, BODY_H), (R_IN, LIP_T),
                 (R_IN - LIP_W, LIP_T)])
    # centring ribs between the slots
    for i in range(8):
        rib = (cq.Workplane("XY").box(R_IN + 0.5 - (FIL_D / 2 + 0.5), 2, FIL_H)
               .translate(((R_IN + 0.5 + FIL_D / 2 + 0.5) / 2, 0, FIL_Z + FIL_H / 2)))
        b = b.union(radial(rib, i * 45 + 180.0 / 56))
    # tall intake slots all round the filter's side
    n = 56
    h = FIL_H - 12
    for i in range(n):
        slot = (cq.Workplane("XY").box(10, 3.6, h).edges("|X").fillet(1.7)
                .translate((R_OUT, 0, FIL_Z + FIL_H / 2)))
        b = b.cut(radial(slot, 360.0 * i / n))
    return b


def cap():
    # ring + spigot + top ledge for the grille disc, one revolved solid
    c = revolve([(R_IN - 0.3 - W, DECK_Z + T), (R_IN - 0.3, DECK_Z + T), (R_IN - 0.3, BODY_H),
                 (R_OUT, BODY_H), (R_OUT, CAP_TOP - 1.5), (R_OUT - 1.5, CAP_TOP),
                 (R_IN, CAP_TOP), (R_IN, TOP_Z), (R_IN - 3, TOP_Z), (R_IN - 3, TOP_Z - 2),
                 (R_IN, TOP_Z - 5), (R_IN, BODY_H + 2), (R_IN - 0.3 - W, BODY_H + 2)])
    c = c.cut(wall_hole(90, BODY_H + 9, 11.0))               # rear DC jack
    c = c.cut(wall_hole(-90 - CTRL_A, UI_Z, 16.0))           # power button
    c = c.cut(wall_hole(-90 + CTRL_A, UI_Z, 7.5))            # speed pot
    return c


def disc(z, holes_fn=None):
    d = cq.Workplane("XY").workplane(offset=z).circle(DISC_D / 2).extrude(T)
    if holes_fn:
        d = holes_fn(d)
    return d


def floor_disc():
    return disc(LIP_T)


def deck_disc():
    return disc(DECK_Z, lambda d: d.cut(
        cq.Workplane("XY").workplane(offset=DECK_Z - 1).circle(FIL_ID / 2 - 1).extrude(T + 2)))


def top_disc():
    s = FAN_HOLE / 2

    def holes(d):
        wp = cq.Workplane("XY").workplane(offset=TOP_Z - 1)
        d = d.cut(wp.pushPoints(hex_grid(6.5, 22, 56)).circle(2.6).extrude(T + 2))
        return d.cut(wp.pushPoints([(x, y) for x in (-s, s) for y in (-s, s)])
                     .circle(2.2).extrude(T + 2))
    return disc(TOP_Z, holes)


def fan_frame():
    f = cq.Workplane("XY").box(FAN, FAN, FAN_T).edges("|Z").fillet(6)
    f = f.cut(cq.Workplane("XY").circle(58).extrude(FAN_T, both=True))
    s = FAN_HOLE / 2
    f = f.cut(cq.Workplane("XY").workplane(offset=-FAN_T)
              .pushPoints([(x, y) for x in (-s, s) for y in (-s, s)])
              .circle(2.2).extrude(2 * FAN_T))
    f = f.union(cq.Workplane("XY").box(2 * 58, 4, 4).translate((0, 0, FAN_T / 2 - 2))
                .rotate((0, 0, 0), (0, 0, 1), 45))
    return f.translate((0, 0, FAN_Z + FAN_T / 2))


def fan_rotor():
    hub = cq.Workplane("XY").circle(20).extrude(FAN_T / 2 - 3, both=True)
    for i in range(7):
        bl = (cq.Workplane("XY").box(36, 2, FAN_T - 8).translate((37, 0, 0))
              .rotate((0, 0, 0), (1, 0, 0), 30)
              .rotate((0, 0, 0), (0, 0, 1), i * 360 / 7))
        hub = hub.union(bl)
    return hub.translate((0, 0, FAN_Z + FAN_T / 2))


def filt():
    f = (cq.Workplane("XY").workplane(offset=FIL_Z)
         .circle(FIL_D / 2).circle(FIL_ID / 2).extrude(FIL_H))
    return f.cut(cq.Workplane("XY").workplane(offset=FIL_Z + 4)
                 .circle(FIL_D / 2 + 1).circle(FIL_D / 2 - 1.5).extrude(FIL_H - 8))


def button():
    b = cq.Workplane("YZ").workplane(offset=R_OUT).center(0, UI_Z).circle(9.5).extrude(2)
    b = b.union(cq.Workplane("YZ").workplane(offset=R_OUT).center(0, UI_Z).circle(7.5).extrude(-20))
    b = b.union(cq.Workplane("YZ").workplane(offset=R_OUT + 2).center(0, UI_Z).circle(6.5).extrude(1.5))
    return radial(b, -90 - CTRL_A)


def knob():
    k = cq.Workplane("YZ").workplane(offset=R_OUT + 1).center(0, UI_Z).circle(10).extrude(14)
    try:
        k = k.faces(">X").edges().fillet(2)
    except Exception:
        pass
    k = k.union(cq.Workplane("YZ").workplane(offset=R_OUT - 11).center(0, UI_Z).circle(8.5).extrude(9))
    return radial(k, -90 + CTRL_A)


def controller():
    # PWM speed board stuck (VHB) under the top disc, beside the fan
    return cq.Workplane("XY").box(28, 45, 15).translate((78, 0, TOP_Z - 7.5))


def lift(shape):
    return shape.translate((0, 0, DZ))


def parts():
    s = FAN_HOLE / 2
    for name, shp in (("Body", body()), ("Top cap", cap())):
        n = len(shp.solids().vals())
        assert n == 1, f"{name} is {n} separate solids"
    feet = None
    for a in (45, 135, 225, 315):
        x, y = 80 * math.cos(math.radians(a)), 80 * math.sin(math.radians(a))
        f = cq.Workplane("XY").center(x, y).circle(6.35).extrude(FOOT_H)
        try:
            f = f.faces("<Z").edges().fillet(2.5)
        except Exception:
            pass
        feet = f if feet is None else feet.union(f)
    acrylic = {"material": "acrylic", "thickness_mm": T}
    return [
        {"name": "Body ring", "shape": lift(body()), "group": "case", "color": "#e9e6df"},
        {"name": "Cap ring", "shape": lift(cap()), "group": "case", "color": "#5b6b73",
         "explode": [0, 0, 1]},
        {"name": "Floor disc", "shape": lift(floor_disc()), "group": "case",
         "process": "laser", "params": acrylic, "color": "#2a2a2a", "explode": [0, 0, -1]},
        {"name": "Deck disc", "shape": lift(deck_disc()), "group": "case",
         "process": "laser", "params": acrylic, "color": "#2a2a2a", "explode": [0, 0, 0.7]},
        {"name": "Top grille disc", "shape": lift(top_disc()), "group": "case",
         "process": "laser", "params": acrylic, "color": "#3c4a52", "explode": [0, 0, 1.3]},
        {"name": "120 mm 12 V PWM fan", "id": "fan_frame", "shape": lift(fan_frame()),
         "group": "component", "color": "#2b2b2b", "explode": [0, 0, 1.15]},
        {"name": "Fan rotor", "id": "fan_rotor", "shape": lift(fan_rotor()),
         "group": "component", "color": "#3a3a3a", "explode": [0, 0, 1.15]},
        {"name": "HEPA filter (radial, 190 x 62)", "shape": lift(filt()), "group": "component",
         "color": "#f4f4f0", "explode": [0, 0, 0.4]},
        {"name": "PWM speed controller board", "shape": lift(controller()),
         "group": "component", "color": "#1f6f3f", "explode": [0, 0, 1.15]},
        {"name": "Speed knob + pot", "shape": lift(knob()), "group": "component",
         "color": "#1c1c1c"},
        {"name": "16 mm latching power button", "shape": lift(button()),
         "group": "component", "color": "#c0c4c8"},
        {"name": "Rubber feet 12.7 x 8", "shape": feet, "group": "component",
         "color": "#222222"},
        part("m4x35_bhcs", at=[(x, y, CAP_TOP + DZ) for x in (-s, s) for y in (-s, s)]),
        part("m4_nut", at=[(x, y, FAN_Z - 3.2 + DZ) for x in (-s, s) for y in (-s, s)]),
        part("dc_jack_panel", at=(0, R_OUT, BODY_H + 9 + DZ), rot=(-90, 0, 0)),
    ]


def motion():
    return [{"part": "fan_rotor", "type": "spin", "axis": [0, 0, 1],
             "pivot": [0, 0, FAN_Z + DZ], "turns": 3}]
