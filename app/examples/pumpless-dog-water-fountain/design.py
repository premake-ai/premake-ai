"""Pumpless dog fountain.

A bought 3 qt stainless bowl sits in a printed base. A DC motor in the dry
base spins a magnet hub under the bowl floor; it drives a magnet impeller in
the water (no wires or seals in the water). Water enters the Spout dome through
foam-covered slots, the impeller pushes it up the riser and it bubbles out of
the crown and runs down the dome. A PIR wakes it when the dog comes close.
Everything wet lifts out: bowl -> dishwasher, dome / cover / impeller -> rinse.
"""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

SCENE = "floor"

# Bowl: Scott Pet 3 qt stainless, rim 9.81 in (249 mm) x 3.25 in (82.5 mm).
# Bottom diameter not published: ~7 in (178 mm), from a typical 3 qt bowl.
BOWL_RIM_R = 124.5
BOWL_BOT_R = 89.0
BOWL_H = 82.5
BOWL_T = 0.8
SLOPE = (BOWL_RIM_R - BOWL_BOT_R) / BOWL_H  # dr/dz of the bowl wall

FEET = 3.5                              # stick-on rubber bumpers
T_ACR = fab.sheet_actual("acrylic", 3)  # laser-cut bottom plate
P = FEET + T_ACR                        # top of bottom plate
BASE_R = 101.0
WALL = 2.0
ZB = 45.0                               # underside of the bowl
TOP = ZB + 13                          # top of base (bowl seat)
ZF = ZB + BOWL_T                        # inside floor of the bowl

# motor stack (130 size DC motor, shaft up, centred under the bowl)
HUB_TOP = ZB - 1.5
HUB_Z0 = HUB_TOP - 5
MOTOR_TOP = HUB_Z0 - 1
MOTOR_Z0 = MOTOR_TOP - 25
MAG_X = 7.5                              # 10x3 magnets at +-7.5 mm
BOSS_R = 95.5
BOSS_ANG = [45, 135, 225, 315]


def revolve(pts):
    return cq.Workplane("XZ").polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))


def cyl(r, h, x=0, y=0, z=0):
    return cq.Workplane("XY").circle(r).extrude(h).translate((x, y, z))


def box(sx, sy, sz, x, y, z):  # z = bottom
    return cq.Workplane("XY").box(sx, sy, sz, centered=(True, True, False)).translate((x, y, z))


def tube(r, p0, p1):
    v = cq.Vector(*p1) - cq.Vector(*p0)
    return cq.Workplane("XY").add(cq.Solid.makeCylinder(r, v.Length, cq.Vector(*p0), v.normalized()))


def boss_xy(a):
    return BOSS_R * math.cos(math.radians(a)), BOSS_R * math.sin(math.radians(a))


# ---------------------------------------------------------------- base
def base():
    seat_lo = ZB + (93 - BOWL_BOT_R) / SLOPE
    b = revolve([(BASE_R - WALL, P), (BASE_R, P), (BASE_R, TOP),
                 (BOWL_BOT_R + SLOPE * (TOP - ZB) + 0.3, TOP),
                 (93.3, seat_lo), (BASE_R - WALL, seat_lo - (BASE_R - WALL - 93.3))])
    try:
        b = b.faces(">Z").edges("%CIRCLE").edges(cq.selectors.RadiusNthSelector(-1)).fillet(1.5)
    except Exception:
        pass
    # screw bosses for the bottom plate (M3 heat-set inserts from below)
    for a in BOSS_ANG:
        x, y = boss_xy(a)
        b = b.union(cyl(4.5, 10, x, y, P)).union(
            cq.Workplane("XY").add(cq.Solid.makeCone(4.5, 0.8, 4, cq.Vector(x, y, P + 10))))
        b = b.cut(cyl(2.0, 6.7, x, y, P))
    # shelf for the USB-C charger at the back (45 deg gusset, no supports)
    shelf = (cq.Workplane("YZ").polyline([(68, 35), (BASE_R - 1, 35), (BASE_R - 1, P + 3), (68, 32)])
             .close().extrude(24).translate((-12, 0, 0)))
    b = b.union(shelf.intersect(cyl(BASE_R - 1, 40, z=P)))
    # USB-C port, PIR window, status LED
    b = b.cut(cq.Workplane("XZ").center(0, 38.2).rect(10, 4.5).extrude(-10).translate((0, BASE_R - 4, 0)).edges("|Y").fillet(1.5))
    b = b.cut(cq.Workplane("XZ").center(0, 40).circle(5.1).extrude(10).translate((0, -BASE_R + 4, 0)))
    b = b.cut(cq.Workplane("XZ").center(25, 40).circle(2.6).extrude(10).translate((0, -BASE_R + 4, 0)))
    return b


def bottom_plate():
    holes = [(*boss_xy(a), 3.4) for a in BOSS_ANG] + [(18, 0, 3.4), (-18, 0, 3.4)]
    pl = cyl(BASE_R, T_ACR, z=FEET)
    for x, y, d in holes:
        pl = pl.cut(cyl(d / 2, 10, x, y, 0))
    return pl


def motor_mount():
    m = cyl(22, 3, z=P).union(cyl(14, 20, z=P))
    pocket = cyl(10.35, 30, z=P + 3).intersect(box(30, 15.6, 30, 0, 0, P + 3))
    m = m.cut(pocket).cut(cyl(4, 5, z=P - 1))
    m = m.cut(box(8, 30, 6, 0, 0, P + 3).intersect(box(8, 30, 6, 0, -15, P + 3)))  # wire exit (-Y)
    m = m.cut(cq.Workplane("YZ").center(0, P + 15).circle(1.25).extrude(20))        # clamp screw (self-tap)
    for x in (18, -18):
        m = m.cut(cyl(1.7, 10, x, 0, P - 1))
    return m


def motor():
    body = cyl(10.2, 25, z=MOTOR_Z0).intersect(box(30, 15.2, 25, 0, 0, MOTOR_Z0))
    return body.union(cyl(3.2, 1.0, z=MOTOR_TOP)).union(cyl(1.0, 6.5, z=MOTOR_TOP))


def drive_hub():
    h = cyl(13, 5, z=HUB_Z0).cut(cyl(0.95, 7, z=HUB_Z0 - 0.5))
    for x in (MAG_X, -MAG_X):
        h = h.cut(cyl(5.1, 3.2, x, 0, HUB_TOP - 3.2))
    try:
        h = h.faces(">Z").edges("not %LINE").edges(cq.selectors.RadiusNthSelector(-1)).chamfer(0.8)
    except Exception:
        pass
    return h


def magnets(z_list):
    return [cyl(5, 3, x, 0, z) for x in (MAG_X, -MAG_X) for z in z_list]


# ---------------------------------------------------------------- bowl
def bowl():
    outer = revolve([(0, 0), (BOWL_BOT_R, 0), (BOWL_RIM_R, BOWL_H), (0, BOWL_H)])
    inner = revolve([(0, BOWL_T), (BOWL_BOT_R - BOWL_T, BOWL_T),
                     (BOWL_RIM_R - BOWL_T, BOWL_H + 0.1), (0, BOWL_H + 0.1)])
    lip = revolve([(BOWL_RIM_R - 2.5, BOWL_H - 2.5), (BOWL_RIM_R + 1, BOWL_H - 2.5),
                   (BOWL_RIM_R + 1, BOWL_H), (BOWL_RIM_R - 2.5, BOWL_H)])
    return outer.cut(inner).union(lip).translate((0, 0, ZB))


# ---------------------------------------------------------------- in-water pump
PUMP_R = 40.0
CH_R = 16.5          # impeller chamber inner radius
RISER = (22.0, 8.0)  # riser socket centre (x, y)


def pump_base():
    z = ZF
    b = cyl(PUMP_R, 3, z=z)
    b = b.union(cyl(PUMP_R, 2, z=z + 3).cut(cyl(PUMP_R - 1.8, 3, z=z + 3)))         # dome locating lip
    b = b.union(cyl(CH_R + 2, 8, z=z + 3).cut(cyl(CH_R, 9, z=z + 3)))                # chamber wall
    b = b.union(cyl(6.5, 14, *RISER, z + 3))                                          # riser socket
    b = b.cut(cyl(16, 1.8, z=z + 1.2))                                                # impeller pocket
    b = b.cut(cyl(4.7, 15, *RISER, z + 3))
    b = b.cut(box(9, 6, 6, 18, 8, z + 3))                                             # tangential outlet
    b = b.union(cyl(2.0, 9.3, z=z + 1.2))                                             # impeller pin
    try:
        b = b.faces("<Z").edges().fillet(1.0)
    except Exception:
        pass
    return b


def impeller():
    z = ZF + 1.4
    im = cyl(14.5, 3.5, z=z)
    for k in range(6):
        vane = box(10, 1.6, 5, 9.5, 0, z + 3.5).rotate((0, 0, 0), (0, 0, 1), k * 60)
        im = im.union(vane)
    im = im.union(cyl(4.0, 8.5, z=z)).cut(cyl(2.25, 12, z=z - 1))
    for x in (MAG_X, -MAG_X):
        im = im.cut(cyl(5.1, 3.1, x, 0, z - 0.01))
    return im


def pump_cover():
    z = ZF + 11
    c = cyl(CH_R + 2, 2, z=z).union(cyl(CH_R - 0.2, 2, z=z - 2).cut(cyl(CH_R - 1.7, 3, z=z - 2.5)))
    return c.cut(cyl(5, 5, z=z - 3))


def spout_dome():
    z = ZF
    r0, r1, h_top = PUMP_R - 2.0, 10.0, 68.0
    shell = revolve([(0, z + 3), (r0, z + 3), (r1, z + h_top), (0, z + h_top)]).cut(
        revolve([(0, z + 2.9), (r0 - 1.9, z + 2.9), (r1 - 1.2, z + h_top - 2), (0, z + h_top - 2)]))
    try:
        shell = shell.faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    p_bot = (RISER[0], RISER[1], z + 10)
    p_mid = (RISER[0], RISER[1], z + 20)
    p_top = (0, 0, z + h_top - 1.5)
    d = shell.union(tube(4.5, p_bot, p_mid)).union(tube(4.5, p_mid, p_top))
    d = d.union(cq.Workplane("XY").sphere(4.5).translate(p_mid))
    d = d.cut(tube(3.0, (RISER[0], RISER[1], z + 9), p_mid)).cut(tube(3.0, p_mid, (0, 0, z + h_top + 2)))
    d = d.cut(cq.Workplane("XY").sphere(3.0).translate(p_mid))
    for k in range(12):  # inlet slots behind the foam
        d = d.cut(box(10, 4, 8, r0 - 2, 0, z + 2.5).rotate((0, 0, 0), (0, 0, 1), 15 + k * 30))
    d = d.cut(cq.Workplane("YZ").center(0, z + 58).circle(1.0).extrude(-30).translate((-5, 0, 0)))  # air vent
    return d


def foam():
    z = ZF + 3
    f = cyl(PUMP_R - 2.6, 12, z=z).cut(cyl(CH_R + 2.2, 13, z=z - 0.5)).cut(cyl(6.8, 13, *RISER, z - 0.5))
    cone_in = revolve([(0, ZF + 2.9), (PUMP_R - 4.2, ZF + 2.9), (8.6, ZF + 66), (0, ZF + 66)])
    return f.intersect(cone_in)


# ---------------------------------------------------------------- electronics dummies
def tp4056():
    return box(17, 28, 1.6, 0, 84, 35).union(box(9, 7.5, 3.2, 0, 95, 36.6))


def mosfet():
    return box(34, 17, 1.6, 60, 0, P).union(box(8, 10, 8, 52, 0, P + 1.6))


def pir():
    body = cq.Workplane("XZ").center(0, 40).circle(5).extrude(-23).translate((0, -BASE_R + 1, 0))
    dome = cq.Workplane("XY").sphere(5).translate((0, -BASE_R + 1, 40))
    return body.union(dome)


def feet():
    s = None
    for a in (0, 90, 180, 270):
        c = cyl(6.35, FEET, 80 * math.cos(math.radians(a)), 80 * math.sin(math.radians(a)), 0)
        s = c if s is None else s.union(c)
    return s


def parts():
    insert_at = [(*boss_xy(a), P) for a in BOSS_ANG]
    return [
        {"name": "Base", "shape": base(), "group": "case", "color": "#ece8e1"},
        {"name": "Bottom plate", "shape": bottom_plate(), "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}, "color": "#202020", "explode": [0, 0, -1]},
        {"name": "Motor mount", "shape": motor_mount(), "group": "case", "color": "#5a6b78"},
        {"name": "Drive hub", "id": "drive_hub", "shape": drive_hub(), "group": "case", "color": "#5a6b78",
         "fx": {"spin": {"axis": [0, 0, 1], "rpm": 900}}},
        {"name": "Hub magnets 10x3", "shape": magnets([HUB_TOP - 3.0])[0].union(magnets([HUB_TOP - 3.0])[1]),
         "group": "component", "color": "#8a8f96", "fx": {"spin": {"axis": [0, 0, 1], "rpm": 900}}},
        {"name": "DC motor 130", "shape": motor(), "group": "component", "color": "#b8bcc2"},
        {"name": "Stainless bowl", "id": "bowl", "shape": bowl(), "group": "component", "material": "steel",
         "explode": [0, 0, 1]},
        {"name": "Pump base", "id": "pump_base", "shape": pump_base(), "group": "case", "color": "#4f8fae",
         "explode": [0, 0, 1]},
        {"name": "Impeller", "id": "impeller", "shape": impeller(), "group": "case", "color": "#f2f2f2",
         "explode": [0, 0, 1], "fx": {"spin": {"axis": [0, 0, 1], "rpm": 900}}},
        {"name": "Impeller magnets 10x3", "id": "imp_mag",
         "shape": magnets([ZF + 1.4])[0].union(magnets([ZF + 1.4])[1]), "group": "component", "color": "#8a8f96",
         "explode": [0, 0, 1], "fx": {"spin": {"axis": [0, 0, 1], "rpm": 900}}},
        {"name": "Pump cover", "id": "pump_cover", "shape": pump_cover(), "group": "case", "color": "#4f8fae",
         "explode": [0, 0, 1]},
        {"name": "Foam filter", "id": "foam", "shape": foam(), "group": "component", "color": "#2c3a44",
         "explode": [0, 0, 1]},
        {"name": "Spout dome", "id": "dome", "shape": spout_dome(), "group": "case", "color": "#7fb8cf",
         "explode": [0, 0, 1]},
        {"name": "USB-C charger TP4056", "shape": tp4056(), "group": "component", "color": "#1d4fa0",
         "cable": {"type": "usb-c", "at": [0, BASE_R, 38.2], "dir": [0, 1, 0], "length_mm": 400}},
        {"name": "MOSFET module", "shape": mosfet(), "group": "component", "color": "#1d4fa0"},
        {"name": "PIR sensor AM312", "shape": pir(), "group": "component", "color": "#f4f4f4"},
        {"name": "Rubber feet", "shape": feet(), "group": "component", "material": "rubber", "color": "#222222"},
        part("holder_18650", at=[(0, 50, P), (0, -50, P)]),
        part("cell_18650", at=[(0, 50, P + 1.5), (0, -50, P + 1.5)]),
        part("esp32_c3_supermini", at=(-60, 0, P + 1)),
        part("led_5mm", at=(25, -BASE_R + 3.5, 40), rot=(90, 0, 0)),
        part("m3_insert", at=insert_at),
        part("m3x8_bhcs", at=[(x, y, FEET) for x, y, _ in insert_at], rot=(180, 0, 0)),
        part("m3x10_bhcs", at=[(18, 0, FEET), (-18, 0, FEET)], rot=(180, 0, 0)),
        part("m3_nut", at=[(18, 0, P + 3), (-18, 0, P + 3)]),
        part("m3x6_bhcs", at=(14.2, 0, P + 15), rot=(0, 90, 0)),
    ]


WET = ["bowl", "pump_base", "impeller", "imp_mag", "pump_cover", "foam", "dome"]


def motion():
    from cadlib.motion import move, ease

    def pose(t):
        # lift the dome off, then the whole bowl comes out for the dishwasher
        a = ease(min(1, t / 0.3)) if t < 0.5 else ease(max(0, (1 - t) / 0.3))
        b = ease(min(1, max(0, (t - 0.2) / 0.25))) if t < 0.6 else ease(max(0, (0.9 - t) / 0.25))
        out = {k: move((0, 0, 90 * b)) for k in WET}
        out["dome"] = move((0, 0, 90 * b + 70 * a))
        return out
    return {"duration": 6, "pose": pose}


ASSEMBLY = [["Base"], ["Motor mount", "DC motor 130", "Drive hub", "Hub magnets 10x3"],
            ["USB-C charger TP4056", "MOSFET module", "PIR sensor AM312"],
            ["Bottom plate", "Rubber feet"], ["Stainless bowl"],
            ["Pump base", "Impeller", "Impeller magnets 10x3", "Pump cover", "Foam filter", "Spout dome"]]
