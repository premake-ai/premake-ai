"""Lattice planter: a cachepot for a 4 in (10 cm) nursery pot. A diamond lattice skin over a
solid saucer base: the plant stays in its plastic pot, water drains into the hidden saucer, and
three floor ribs keep the pot out of the puddle. The lattice is the print-native part: impossible
to mould, cheap to print, about 40 % less plastic than a solid wall.

Z up, mm, front faces -Y. Prints upright in one piece: diamonds are 45 deg, the bulged wall leans
out under 15 deg, no supports. Try silk or matte PLA.
"""
import math
import cadquery as cq

P = {
    "height": 100.0,
    "r_base": 41.0, "r_belly": 52.0, "r_top": 55.0,   # outer radii (base / ~55 % height / rim)
    "wall": 2.2, "floor": 2.4,
    "saucer_h": 22.0,          # solid band at the bottom (holds drained water)
    "rim_h": 9.0,              # solid band at the top
    "cells": 16,               # diamonds per row
    "diamond": 10.0,
}
COL = "#e9c46a"


def profile_r(z):
    """Outer radius at height z (matches the spline closely enough for placing the lattice)."""
    H = P["height"]
    pts = [(0, P["r_base"]), (12, P["r_base"] + 4), (H * 0.55, P["r_belly"]), (H, P["r_top"])]
    for (z0, r0), (z1, r1) in zip(pts, pts[1:]):
        if z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return P["r_top"]


def pot():
    H, w = P["height"], P["wall"]
    outer = (cq.Workplane("XZ").moveTo(0, 0).lineTo(P["r_base"], 0)
             .spline([(P["r_base"] + 4, 12), (P["r_belly"], H * 0.55), (P["r_top"], H)], includeCurrent=True)
             .lineTo(0, H).close().revolve(360, (0, 0, 0), (0, 1, 0)))
    try:
        body = outer.faces(">Z").shell(-w)
    except Exception:
        inner = cq.Workplane("XY").circle(P["r_base"] - w).workplane(offset=H).circle(P["r_top"] - w).loft()
        body = outer.cut(inner.translate((0, 0, P["floor"])))
    try:
        body = body.faces(">Z").edges().fillet(0.9)
    except Exception:
        pass
    try:
        body = body.faces("<Z").edges().chamfer(0.8)
    except Exception:
        pass
    # diamond lattice between the saucer band and the rim band
    d = P["diamond"]
    diag = d * math.sqrt(2)
    n = P["cells"]
    z = P["saucer_h"] + diag / 2
    row = 0
    cutter = None
    while z + diag / 2 <= H - P["rim_h"]:
        r = profile_r(z)
        for k in range(n):
            ang = (k + 0.5 * (row % 2)) * 360.0 / n
            dm = (cq.Workplane("XY").box(d, 16, d).rotate((0, 0, 0), (0, 1, 0), 45)
                  .translate((0, -r, z)).rotate((0, 0, 0), (0, 0, 1), ang))
            cutter = dm if cutter is None else cutter.union(dm)
        z += diag / 2 + 2.6
        row += 1
    if cutter is not None:
        body = body.cut(cutter)
    # floor ribs: the nursery pot stands above the drained water
    for k in range(3):
        rib = (cq.Workplane("XY").box(P["r_base"] * 1.2, 2.4, 4.0).translate((P["r_base"] * 0.45, 0, P["floor"] + 2.0))
               .rotate((0, 0, 0), (0, 0, 1), k * 120 + 90))
        body = body.union(rib)
    return body


def parts():
    return [
        {"name": "Lattice planter", "shape": pot(), "group": "case", "color": COL, "explode": [0, 0, 0]},
    ]
