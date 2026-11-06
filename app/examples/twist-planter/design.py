"""Twisted faceted planter with drainage holes, feet and a matching saucer.

Z up, mm. Pot prints upright with 3 walls (no supports, the twist overhang is < 20 deg).
"""
import math

import cadquery as cq

N = 10
R_BOT, R_TOP, HEIGHT = 50.0, 66.0, 118.0
TWIST = 18.0
WALL, FLOOR = 2.4, 3.0
SAUCER_R, SAUCER_H = 76.0, 16.0
POT_Z = 4.4             # pot sits on its feet inside the saucer


def ngon(r, z, rot_deg):
    a0 = math.radians(rot_deg)
    return [(r * math.cos(a0 + 2 * math.pi * i / N), r * math.sin(a0 + 2 * math.pi * i / N)) for i in range(N)]


def twisted(r0, r1, z0, z1, rot0, rot1):
    w0 = cq.Wire.makePolygon([cq.Vector(x, y, z0) for x, y in ngon(r0, z0, rot0)], close=True)
    w1 = cq.Wire.makePolygon([cq.Vector(x, y, z1) for x, y in ngon(r1, z1, rot1)], close=True)
    return cq.Workplane("XY").add(cq.Solid.makeLoft([w0, w1], True))


def make_pot():
    k = (R_TOP - R_BOT) / HEIGHT
    outer = twisted(R_BOT, R_TOP, 0, HEIGHT, 0, TWIST)
    inner = twisted(R_BOT + k * FLOOR - WALL, R_TOP - WALL, FLOOR, HEIGHT + 1, TWIST * FLOOR / HEIGHT,
                    TWIST * (HEIGHT + 1) / HEIGHT)
    pot = outer.cut(inner)
    # drainage holes
    holes = cq.Workplane("XY").pushPoints([(0, 0)] + [(22 * c, 22 * s) for c, s in
                                                       ((1, 0), (-0.5, 0.866), (-0.5, -0.866))]).circle(4.0).extrude(10).translate((0, 0, -1))
    pot = pot.cut(holes)
    # three feet
    for c, s in ((0.5, 0.866), (-1, 0), (0.5, -0.866)):
        foot = cq.Workplane("XY").center(36 * c, 36 * s).circle(6).extrude(3.0).translate((0, 0, -3.0))
        pot = pot.union(foot)
    return pot.translate((0, 0, POT_Z))


def make_saucer():
    prof = [(0, 0), (SAUCER_R - 4, 0), (SAUCER_R, SAUCER_H), (SAUCER_R - 2.4, SAUCER_H),
            (SAUCER_R - 6.2, 2.0), (0, 2.0)]
    s = cq.Workplane("XZ").polyline(prof).close().revolve(360, (0, 0, 0), (0, 1, 0))
    try:
        s = s.faces(">Z").edges().fillet(1.0)
    except Exception:
        pass
    return s


def make_mesh():
    return cq.Workplane("XY").circle(R_BOT - 12).extrude(0.6).translate((0, 0, POT_Z + FLOOR))


def make_soil():
    k = (R_TOP - R_BOT) / HEIGHT
    zt = HEIGHT - 14
    z0 = FLOOR + 0.6
    return twisted(R_BOT + k * z0 - WALL - 0.4, R_BOT + k * zt - WALL - 0.4, z0, zt,
                   TWIST * z0 / HEIGHT, TWIST * zt / HEIGHT).translate((0, 0, POT_Z))


def parts():
    return [
        {"name": "Planter pot", "shape": make_pot(), "group": "case", "color": "#e07a5f", "explode": [0, 0, 1]},
        {"name": "Drip saucer", "shape": make_saucer(), "group": "case", "color": "#f2cc8f", "explode": [0, 0, -1]},
        {"name": "Drainage mesh disc", "shape": make_mesh(), "group": "component", "color": "#555555", "explode": [0, 0, 0.5]},
        {"name": "Potting mix (not included)", "shape": make_soil(), "group": "component", "color": "#5b4636",
         "explode": [0, 0, 1.5]},
    ]
