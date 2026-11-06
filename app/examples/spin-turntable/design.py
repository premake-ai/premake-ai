"""Spin turntable for product photos: a printed drum houses a NEMA17 stepper, an ESP32 and a TMC2209
driver; a 120 mm swivel bearing carries a laser-cut 240 mm acrylic platter. Laser-cut plywood base.
Knob = speed, button = start/stop, long press = 24-stop photo mode. 12 V adapter, fused.

Z up, mm, front faces -Y.
"""
import math
import cadquery as cq
from cadlib import fab

R_DRUM, H_DRUM, WALL = 90.0, 50.0, 2.4
BASE_T = 3.0
Z0 = BASE_T                        # drum bottom
Z_TOP = Z0 + H_DRUM                # drum top surface
TOP_T = 3.0
BRG_T = 8.0
PLAT_T, R_PLAT = 6.0, 120.0
Z_PLAT = Z_TOP + BRG_T

THUMB_VIEW = "iso"


def cyl(r, h, z=0.0, x=0.0, y=0.0):
    return cq.Workplane("XY").circle(r).extrude(h).translate((x, y, z))


def ring():
    """Printed drum wall. The lid and base are laser-cut plywood, which is much faster than printing them."""
    zr = Z_TOP - TOP_T
    d = cyl(R_DRUM, zr - Z0, Z0).cut(cyl(R_DRUM - WALL, zr - Z0, Z0))
    for a in range(0, 360, 90):        # lid lugs with M3 heat-set inserts
        x, y = (R_DRUM - 7) * math.cos(math.radians(a + 45)), (R_DRUM - 7) * math.sin(math.radians(a + 45))
        lug = cyl(5.5, 10, zr - 10, x, y).union(
            cq.Workplane("XY").box(11, 11, 10).translate((x * 1.06, y * 1.06, zr - 5)))
        d = d.union(lug.cut(cyl(2.0, 7, zr - 7, x, y)).intersect(cyl(R_DRUM - 0.1, 60, 0)))
    for a in range(0, 360, 120):       # base lugs
        x, y = (R_DRUM - 8) * math.cos(math.radians(a + 90)), (R_DRUM - 8) * math.sin(math.radians(a + 90))
        lug = cyl(5.5, 8, Z0, x, y).union(cq.Workplane("XY").box(11, 11, 8).translate((x * 1.06, y * 1.06, Z0 + 4)))
        d = d.union(lug.cut(cyl(2.0, 7, Z0, x, y)).intersect(cyl(R_DRUM - 0.1, 60, 0)))
    # front: speed knob + button; back: DC jack
    for x, r in ((-22, 3.75), (22, 6.0)):
        d = d.cut(cq.Workplane("XZ").center(x, Z0 + 24).circle(r).extrude(-20).translate((0, -R_DRUM + 6, 0)))
    d = d.cut(cq.Workplane("XZ").center(0, Z0 + 14).circle(5.6).extrude(20).translate((0, R_DRUM - 6, 0)))
    for z in (Z0 + 8, zr - 10):        # decorative grooves
        d = d.cut(cyl(R_DRUM + 1, 1.2, z).cut(cyl(R_DRUM - 0.8, 1.2, z)))
    return d


def lid():
    zr = Z_TOP - TOP_T
    d = cyl(R_DRUM, TOP_T, zr)
    d = d.cut(cyl(11.5, TOP_T, zr))
    for sx in (-15.5, 15.5):
        for sy in (-15.5, 15.5):
            d = d.cut(cyl(1.7, TOP_T, zr, sx, sy))
    for a in range(0, 360, 90):
        x, y = 50 * math.cos(math.radians(a + 45)), 50 * math.sin(math.radians(a + 45))
        d = d.cut(cyl(2.25, TOP_T, zr, x, y))
        x, y = (R_DRUM - 7) * math.cos(math.radians(a + 45)), (R_DRUM - 7) * math.sin(math.radians(a + 45))
        d = d.cut(cyl(1.7, TOP_T, zr, x, y))
    return d


def base():
    b = cyl(R_DRUM + 3, BASE_T)
    for a in range(0, 360, 120):
        x, y = (R_DRUM - 8) * math.cos(math.radians(a + 90)), (R_DRUM - 8) * math.sin(math.radians(a + 90))
        b = b.cut(cyl(1.7, BASE_T, 0, x, y))
    for a in range(0, 360, 30):  # vent ring
        x, y = 55 * math.cos(math.radians(a)), 55 * math.sin(math.radians(a))
        b = b.cut(cyl(3.0, BASE_T, 0, x, y))
    return b


def platter():
    p = cyl(R_PLAT, PLAT_T, Z_PLAT)
    p = p.cut(cyl(3.0, PLAT_T, Z_PLAT, 0, 0))
    for a in range(0, 360, 90):
        x, y = 50 * math.cos(math.radians(a)), 50 * math.sin(math.radians(a))
        p = p.cut(cyl(2.25, PLAT_T, Z_PLAT, x, y))
    for a in range(0, 360, 120):       # hub screws
        x, y = 10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a))
        p = p.cut(cyl(1.7, PLAT_T, Z_PLAT, x, y))
    return p


def bearing():
    r = cyl(60, BRG_T / 2, Z_TOP).cut(cyl(36, BRG_T / 2, Z_TOP))
    r2 = cyl(60, BRG_T / 2, Z_TOP + BRG_T / 2).cut(cyl(36, BRG_T / 2, Z_TOP + BRG_T / 2))
    return r.union(r2)


def hub():
    h = cyl(15, Z_PLAT - Z_TOP - 0.5, Z_TOP + 0.5)
    h = h.cut(cyl(2.55, 30, Z_TOP))
    for a in range(0, 360, 120):
        x, y = 10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a))
        h = h.cut(cyl(1.7, 10, Z_TOP, x, y))
    return h


def knob():
    k = cq.Workplane("XZ").circle(10).extrude(14)
    try:
        k = k.faces("<Y").edges().fillet(2.5)
    except Exception:
        pass
    k = k.cut(cq.Workplane("XZ").center(0, 7).rect(1.6, 5).extrude(1).translate((0, -14, 0)))
    return k.translate((-22, -R_DRUM + 1, Z0 + 24))


def parts():
    motor = fab.nema17(40).translate((0, 0, Z_TOP - TOP_T - 10))   # hangs on 4 x M3 x 10 standoffs
    stand = None
    for sx in (-15.5, 15.5):
        for sy in (-15.5, 15.5):
            c = cyl(2.75, 10, Z_TOP - TOP_T - 10, sx, sy)
            stand = c if stand is None else stand.union(c)
    esp = fab.esp32_devkit("wroom").translate((40, 25, Z0 + 12))
    drv = fab.stepstick().translate((-40, 30, Z0 + 12))
    bk = fab.buck("mp1584").translate((-40, -10, Z0 + 1))
    btn = cq.Workplane("XZ").circle(8).extrude(4).union(cq.Workplane("XZ").circle(6).extrude(-18)).translate((22, -R_DRUM + 2, Z0 + 24))
    jack = cq.Workplane("XZ").circle(5.5).extrude(-14).translate((0, R_DRUM - 2, Z0 + 14))
    return [
        {"name": "Platter, black acrylic 6 mm", "shape": platter(), "process": "laser", "color": "#2b2e34",
         "params": {"material": "black acrylic", "thickness_mm": PLAT_T}, "explode": [0, 0, 1]},
        {"name": "Drum ring", "shape": ring(), "color": "#efe9dd"},
        {"name": "Lid, birch plywood 3 mm", "shape": lid(), "process": "laser", "color": "#d9b98a",
         "params": {"material": "birch plywood", "thickness_mm": TOP_T}, "explode": [0, 0, 0.5]},
        {"name": "Base, birch plywood 3 mm", "shape": base(), "process": "laser", "color": "#d9b98a",
         "params": {"material": "birch plywood", "thickness_mm": BASE_T}, "explode": [0, 0, -1]},
        {"name": "Shaft hub", "shape": hub(), "color": "#ff7a45", "explode": [0, 0, 0.6]},
        {"name": "Speed knob", "shape": knob(), "color": "#ff7a45", "explode": [0, -1, 0]},
        {"name": "Swivel bearing 120 mm", "shape": bearing(), "group": "component", "explode": [0, 0, 0.8]},
        {"name": "NEMA17 stepper 40 mm", "shape": motor, "group": "component", "explode": [0, 0, -0.5]},
        {"name": "M3 x 10 standoffs", "shape": stand, "group": "component", "color": "#c8a24a", "explode": [0, 0, -0.5]},
        {"name": "ESP32 DevKit V1", "shape": esp, "group": "component", "color": "#3a6ea5", "explode": [0.4, 0.4, -0.5]},
        {"name": "TMC2209 driver", "shape": drv, "group": "component", "explode": [-0.4, 0.4, -0.5]},
        {"name": "MP1584 12 V to 5 V", "shape": bk, "group": "component", "explode": [-0.4, 0, -0.5]},
        {"name": "16 mm push button", "shape": btn, "group": "component", "explode": [0, -1, 0]},
        {"name": "DC jack 5.5 x 2.1", "shape": jack, "group": "component", "explode": [0, 1, 0]},
    ]
