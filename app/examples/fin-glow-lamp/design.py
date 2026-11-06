"""Fin glow lamp: a folded 1.5 mm aluminium channel holds a printed LED rail with a WS2812B strip,
which edge-lights a laser-cut opal acrylic fin. An ESP32-C3 SuperMini runs it from USB-C; a rotary
encoder on the end cap sets brightness (turn) and mode (push). Firmware in firmware/, pins in wiring.md.

Z up, mm, front faces -Y, the lamp runs along X.
"""
import cadquery as cq
from cadlib import fab

L = 240.0              # channel length
BW, BH = 60.0, 40.0    # channel outer width / height
T = 1.5                # sheet thickness
GAP = 7.0              # gap between the top flanges (fin passes through)
FIN_T, FIN_H = 3.0, 130.0
RAIL_X0, RAIL_X1 = -92.0, 108.0
STRIP_Z = 18.0
CAP_T = 4.0

THUMB_VIEW = "iso_low"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def channel():
    h = T / 2
    w = BW / 2 - h
    top = BH - h
    pts = [(-GAP / 2 - h, top), (-w, top), (-w, h), (w, h), (w, top), (GAP / 2 + h, top)]
    s = fab.sheet_bent(pts, L, T)                      # profile in XZ, length along +Y
    s = s.rotate((0, 0, 0), (0, 0, 1), -90).translate((-L / 2, 0, 0))   # -> along +X, centred
    # vent / cable slots in the floor, 4 x M3 holes for the end caps
    for x in (-60, -30, 0, 30, 60):
        s = s.cut(cq.Workplane("XY").center(x, 18).slot2D(18, 4, 0).extrude(T * 2).translate((0, 0, -T / 2)))
    for x in (-L / 2 + 5, L / 2 - 5):
        for z in (12, 28):
            s = s.cut(cq.Workplane("YZ").center(0, z).circle(1.7).extrude(BW + 4).translate((x, -BW / 2 - 2, 0)))
    return s


def rail():
    r = box(RAIL_X0, RAIL_X1, -9, 9, T, BH - T - 0.4)
    r = r.cut(box(RAIL_X0 - 1, RAIL_X1 + 1, -5.3, 5.3, STRIP_Z, STRIP_Z + 3))                  # strip pocket
    r = r.cut(box(RAIL_X0 + 3, RAIL_X1 - 3, -FIN_T / 2 - 0.2, FIN_T / 2 + 0.2, STRIP_Z + 3, BH))  # fin slot
    r = r.cut(box(RAIL_X0 - 1, RAIL_X1 + 1, -7.4, 7.4, T - 1, STRIP_Z - 1.6))                         # hollow wire tunnel
    r = r.cut(box(RAIL_X0 - 1, RAIL_X1 + 1, -10, -4.0, STRIP_Z + 4, BH))                       # slim the top
    r = r.cut(box(RAIL_X0 - 1, RAIL_X1 + 1, 4.0, 10, STRIP_Z + 4, BH))
    return r


def fin():
    z0 = STRIP_Z + 3.2
    f = (cq.Workplane("XZ").moveTo(RAIL_X0 + 3.5, z0).lineTo(RAIL_X1 - 3.5, z0)
         .lineTo(RAIL_X1 - 3.5, z0 + FIN_H * 0.62)
         .threePointArc(((RAIL_X0 + RAIL_X1) / 2 + 30, z0 + FIN_H), (RAIL_X0 + 3.5, z0 + FIN_H * 0.82))
         .close().extrude(-FIN_T / 2, both=True))
    return f


def end_cap(sx):
    """Printed cap that plugs the channel end. sx = -1 (USB end) or +1 (encoder end)."""
    xo = sx * L / 2
    plate = box(0, CAP_T, -BW / 2 - 0.5, BW / 2 + 0.5, 0, BH + 0.5)
    try:
        plate = plate.edges("|X").fillet(3.0)
    except Exception:
        pass
    plug = box(-12, 0, -BW / 2 + T + 0.3, BW / 2 - T - 0.3, T + 0.3, BH - T - 0.3)
    plug = plug.cut(box(-13, -2, -BW / 2 + T + 2.3, BW / 2 - T - 2.3, T + 2.3, BH - T - 2.3))
    plug = plug.cut(box(-13, 1, -GAP / 2 - 2, GAP / 2 + 2, BH - T - 3, BH))   # fin clearance
    c = plate.union(plug)
    for z in (12, 28):  # M3 heat-set inserts in the plug walls
        c = c.cut(cq.Workplane("XZ").center(-7, z).circle(2.0).extrude(-BW, both=True))
    if sx < 0:
        c = c.cut(box(-14, CAP_T + 1, -14 - 4.6, -14 + 4.6, 4.0, 8.0))   # USB-C window
    else:
        c = c.cut(cq.Workplane("YZ").center(-14, 20).circle(3.75).extrude(CAP_T * 3).translate((-CAP_T, 0, 0)))
    if sx < 0:
        c = c.mirror("YZ")
    return c.translate((xo, 0, 0))


def knob():
    k = cq.Workplane("YZ").circle(9).extrude(14)
    try:
        k = k.faces(">X").edges().fillet(2)
    except Exception:
        pass
    for i in range(18):
        import math
        a = i * 20 * math.pi / 180
        k = k.cut(cq.Workplane("YZ").center(9 * math.cos(a), 9 * math.sin(a)).circle(0.9).extrude(10).translate((4, 0, 0)))
    return k.translate((L / 2 + CAP_T + 1, -14, 20))


def parts():
    esp = fab.esp32_devkit("c3mini").rotate((0, 0, 0), (0, 0, 1), 180).translate((-L / 2 + 11.25 - 1, -14, T + 2))
    enc = box(-6.5, 0, -6, 6, 14, 26).union(cq.Workplane("YZ").center(-14, 20).circle(3.5).extrude(7)).translate((L / 2 - 12, 0, 0))
    enc = box(L / 2 - 18.5, L / 2 - 12, -20, -8, 14, 26).union(
        cq.Workplane("YZ").circle(3.5).extrude(10).translate((L / 2 - 12, -14, 20)))
    return [
        {"name": "Folded aluminium channel", "shape": channel(), "process": "sheet", "color": "#b9c0c8",
         "params": {"material": "aluminium 5052", "thickness_mm": T, "bends": 4}, "explode": [0, 0, -1]},
        {"name": "Opal acrylic fin", "shape": fin(), "process": "laser", "color": "#fff1d6",
         "params": {"material": "opal acrylic", "thickness_mm": FIN_T}, "explode": [0, 0, 1]},
        {"name": "LED rail", "shape": rail(), "color": "#2b2f36", "explode": [0, 0, 0.4]},
        {"name": "End cap, USB", "shape": end_cap(-1), "color": "#ff6b4a", "explode": [-1, 0, 0]},
        {"name": "End cap, dial", "shape": end_cap(1), "color": "#ff6b4a", "explode": [1, 0, 0]},
        {"name": "Dial knob", "shape": knob(), "color": "#ff6b4a", "explode": [1, 0, 0]},
        {"name": "WS2812B strip, 12 LEDs", "shape": fab.led_strip(199).translate((RAIL_X0 + 0.5, 0, STRIP_Z)),
         "group": "component", "color": "#e8e8e8", "explode": [0, 0, 0.6]},
        {"name": "ESP32-C3 SuperMini", "shape": esp, "group": "component", "color": "#3a6ea5", "explode": [-0.6, 0, 0]},
        {"name": "EC11 rotary encoder", "shape": enc, "group": "component", "explode": [0.6, 0, 0]},
    ]
