"""Linear delta 3D printer: 3 towers, 6 parallel arms, 200 mm round bed."""
import math
import cadquery as cq
from cadlib import fab
from cadlib.parts import part

R = 200            # centre to tower axis
H = 600            # tower height
ARM = 300          # arm length, ball centre to ball centre
CAR_R = R - 45     # carriage ball radius
EFF_R = 30         # effector ball radius
PAIR = 25          # half spacing of a parallel arm pair
EFF_Z = 180        # effector mid-plane (shown mid-print)
HC = EFF_Z + math.sqrt(ARM ** 2 - (CAR_R - EFF_R) ** 2)   # carriage ball height
BAR = 296          # horizontal 2020 bar length
BOT_Z = [10, 74]   # bottom bar layer centres
BED_Z = 88
ANG = [90, 210, 330]   # tower angles (one at the back, front faces -Y)


def rotz(shape, a):
    return shape.rotate((0, 0, 0), (0, 0, 1), a - 90)


def gpt(x, y, z, a):
    t = math.radians(a - 90)
    return (x * math.cos(t) - y * math.sin(t), x * math.sin(t) + y * math.cos(t), z)


def rod(p1, p2, d):
    v = cq.Vector(*p2) - cq.Vector(*p1)
    return cq.Workplane().add(cq.Solid.makeCylinder(d / 2, v.Length, cq.Vector(*p1), v.normalized()))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane().box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def vertex_outline(motor):
    """Local frame: tower at (0, R), centre at -Y."""
    L, w = 65, 12
    pts = [(-14, R + 14)]
    for sx in (-1, 1):
        d = (0.866 * sx, -0.5)
        n = (0.5 * sx, 0.866)
        a_ = (d[0] * L + n[0] * w, R + d[1] * L + n[1] * w)
        b_ = (d[0] * L - n[0] * w, R + d[1] * L - n[1] * w)
        pts_side = [a_, b_, (-56 if motor else -30, R - (72 if motor else 50))] if sx < 0 else \
            [(40 if motor else 30, R - (72 if motor else 50)), b_, a_]
        pts += pts_side
    pts.append((14, R + 14))
    return pts


def bars():
    out = []
    for i in range(3):
        a1, a2 = math.radians(ANG[i]), math.radians(ANG[(i + 1) % 3])
        p1 = (R * math.cos(a1), R * math.sin(a1))
        p2 = (R * math.cos(a2), R * math.sin(a2))
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        ang = math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0]))
        for z in BOT_Z + [H - 10]:
            out.append(fab.extrusion(BAR, axis="x", at=(-BAR / 2, 0, z))
                       .rotate((0, 0, 0), (0, 0, 1), ang).translate((mid[0], mid[1], 0)))
    return out


def parts():
    out = []
    bar_shapes = bars()
    bar_cut = bar_shapes[0]
    for b in bar_shapes[1:]:
        bar_cut = bar_cut.union(b)
    for b in bar_shapes:
        out.append({"name": "Frame bar", "shape": b, "process": "extrusion",
                    "params": {"profile": "2020", "length_mm": BAR, "tapped_ends": 0}})

    vertices = []
    for a in ANG:
        tower = fab.extrusion(H, axis="z", at=gpt(0, R, 0, a))
        out.append({"name": "Tower", "shape": tower, "process": "extrusion",
                    "params": {"profile": "2020", "length_mm": H, "tapped_ends": 0}})
        tower_cut = rotz(box(-10.2, 10.2, R - 10.2, R + 10.2, -1, H + 1), a)

        # bottom vertex with motor pocket and belt slot
        bv = cq.Workplane().polyline(vertex_outline(True)).close().extrude(84)
        try:  # hollow between the bar layers, 4 mm walls
            bv = bv.cut(cq.Workplane().polyline(vertex_outline(True)).close().offset2D(-4)
                        .extrude(40).translate((0, 0, 22)))
        except Exception:
            pass
        bv = bv.cut(box(-54, -11, R - 67, R - 23, 20, 64)).cut(box(-11, 12, R - 58, R - 31, 20, 85))
        bv = rotz(bv, a).cut(tower_cut).cut(bar_cut)
        try:
            bv = bv.edges("|Z").fillet(2)
        except Exception:
            pass
        out.append({"name": "Bottom vertex", "shape": bv, "color": "#2b2b2b", "explode": [0, 0, -1]})
        vertices.append(bv)

        # top vertex with idler slot
        tv = cq.Workplane().polyline(vertex_outline(False)).close().extrude(22).translate((0, 0, H - 22))
        tv = tv.cut(box(-9, 9, R - 56, R - 31, H - 23, H - 3))
        tv = rotz(tv, a).cut(tower_cut).cut(bar_cut)
        out.append({"name": "Top vertex", "shape": tv, "color": "#2b2b2b", "explode": [0, 0, 1]})

        # linear rail on the inner face, block + printed carriage
        out.append({"name": "MGN12 rail", "group": "component", "color": "#9aa0a6",
                    "shape": rotz(box(-6, 6, R - 18, R - 10, 90, 570), a)})
        out.append({"name": "MGN12H block", "group": "component", "color": "#c0c4c8",
                    "shape": rotz(box(-13.5, 13.5, R - 23, R - 15, HC - 23, HC + 23), a)})
        car = box(-22, 22, R - 40, R - 23, HC - 25, HC + 25)
        car = car.union(box(-PAIR - 5, PAIR + 5, R - 40, R - 30, HC - 8, HC + 8))
        car = car.cut(box(-4, 4, R - 40.5, R - 36, HC - 26, HC + 26))  # belt clamp slot
        out.append({"name": "Carriage", "shape": rotz(car, a), "color": "#e85d2a", "explode": [0, 0, 1]})

        # belt
        for y in (R - 45 + 6.4, R - 45 - 6.4):
            out.append({"name": "GT2 belt", "group": "component", "color": "#111111",
                        "shape": rotz(box(-3, 3, y - 0.75, y + 0.75, 42, H - 11), a)})

        # arms with 10 mm magnetic balls
        for sx in (-1, 1):
            top = gpt(sx * PAIR, CAR_R, HC, a)
            bot = gpt(sx * PAIR, EFF_R, EFF_Z, a)
            out.append({"name": "Carbon arm", "group": "component", "color": "#1a1a1a", "shape": rod(top, bot, 6)})
            for p in (top, bot):
                out.append({"name": "Steel ball", "group": "component", "color": "#d0d0d0",
                            "shape": cq.Workplane().sphere(5).translate(p)})

    # motors, pulleys, idlers (shaft along local +X)
    rot = [(0, 90, a - 90) for a in ANG]
    for a, r_ in zip(ANG, rot):
        out.append(part("nema17_40", at=gpt(-12, R - 45, 42, a), rot=r_))
        out.append(part("gt2_pulley_20t", at=gpt(-8, R - 45, 42, a), rot=r_))
        out.append(part("bearing_625", at=[gpt(x, R - 45, H - 11, a) for x in (-5, 0)], rot=r_))

    # Bowden extruder on the back top vertex
    out.append({"name": "Extruder mount", "color": "#2b2b2b", "shape": rotz(box(-66, 0, R - 42, R + 2, H, H + 4), 90)})
    out.append(part("nema17_40", at=gpt(-24, R - 20, H + 25.2, 90), rot=(0, 90, 0)))
    out.append({"name": "Bowden extruder (dual gear)", "group": "component", "color": "#c03030",
                "shape": rotz(box(-22, -2, R - 41, R + 1, H + 4, H + 46), 90)})

    # effector + hotend
    eff = cq.Workplane().cylinder(8, 42).translate((0, 0, EFF_Z)).faces(">Z").workplane().hole(16)
    out.append({"name": "Effector", "shape": eff, "color": "#e85d2a"})
    he = cq.Workplane().cylinder(30, 11).translate((0, 0, EFF_Z - 19))
    he = he.union(box(-6, 14, -8, 8, EFF_Z - 46, EFF_Z - 34.5))
    he = he.union(cq.Workplane().add(cq.Solid.makeCone(0.5, 4, 6, cq.Vector(0, 0, EFF_Z - 52))))
    out.append({"name": "Hotend (V6 style)", "group": "component", "color": "#b8b8b8", "shape": he})
    out.append(part("fan_30", at=(0, -21, EFF_Z - 19), rot=(-90, 0, 0)))

    # bed on three printed clips
    for a in ANG:
        m = math.radians(a + 180)
        out.append({"name": "Bed clip", "color": "#2b2b2b",
                    "shape": cq.Workplane().box(30, 26, 4).rotate((0, 0, 0), (0, 0, 1), a + 90)
                    .translate((100 * math.cos(m), 100 * math.sin(m), 86))})
    out.append({"name": "Heated bed 220 mm", "group": "component", "color": "#b5b5b5",
                "shape": cq.Workplane().cylinder(3, 110).translate((0, 0, BED_Z + 1.5))})

    # floor plate + mainboard
    tri = [(216 * math.cos(math.radians(a)), 216 * math.sin(math.radians(a))) for a in ANG]
    floor = cq.Workplane().polyline(tri).close().extrude(3).intersect(cq.Workplane().circle(150).extrude(3))
    floor = floor.translate((0, 0, 20))
    for v in vertices:
        floor = floor.cut(v)
    out.append({"name": "Floor plate", "shape": floor, "process": "laser", "color": "#222222",
                "params": {"material": "acrylic", "thickness_mm": 3}})
    holes = [(-46, -40), (46, -40), (-46, 22), (46, 22)]
    out.append(part("m3x10_standoff", at=[(x, y, 23) for x, y in holes]))
    out.append({"name": "Mainboard (32-bit, TMC2209)", "group": "component", "color": "#1f6f3f",
                "shape": box(-51, 51, -46, 27, 33, 34.6).union(box(-45, 40, -40, 20, 34.6, 46))})
    return out
