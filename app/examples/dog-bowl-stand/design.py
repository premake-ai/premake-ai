"""Raised dog bowl stand for one standard 1 qt stainless bowl (7 in rim). Arched cut-outs keep
the print light. Z up, mm, front faces -Y. Prints upright, no supports (arches are pointed).
"""
import math
import cadquery as cq

R_BOT, R_TOP, H = 106.0, 94.0, 120.0
T = 2.6
HOLE_R = 79.0             # bowl body drops through, rim (~89 mm R) rests on top ring
TOP_T = 5.0
N_WIN = 6
BOWL_RIM_R, BOWL_BOT_R, BOWL_DEPTH = 89.0, 62.0, 58.0


def make_stand():
    prof = [(0, 0), (R_BOT, 0), (R_TOP, H), (0, H)]
    outer = cq.Workplane("XZ").polyline(prof).close().revolve(360, (0, 0, 0), (0, 1, 0))
    inner_prof = [(0, -1), (R_BOT - T, -1), (R_TOP - T, H - TOP_T), (0, H - TOP_T)]
    inner = cq.Workplane("XZ").polyline(inner_prof).close().revolve(360, (0, 0, 0), (0, 1, 0))
    s = outer.cut(inner)
    s = s.cut(cq.Workplane("XY").circle(HOLE_R).extrude(TOP_T + 2).translate((0, 0, H - TOP_T - 1)))
    # pointed-arch windows (no overhang > 45 deg)
    for i in range(N_WIN):
        a = 360.0 / N_WIN * i + 90
        win = (cq.Workplane("XZ").moveTo(-24, 14).lineTo(24, 14).lineTo(24, 62).lineTo(0, 88)
               .lineTo(-24, 62).close().extrude(-80).translate((0, 60, 0)))
        try:
            win = win.edges("|Y").fillet(5.0)
        except Exception:
            pass
        s = s.cut(win.rotate((0, 0, 0), (0, 0, 1), a))
    try:
        s = s.faces(">Z").edges().fillet(1.5)
    except Exception:
        pass
    # paw-print badge on the front
    for dx, dz, r in ((0, 100, 6), (-9, 109, 3), (-3, 113, 3), (3, 113, 3), (9, 109, 3)):
        pass
    return s


def make_bowl():
    t = 1.0
    prof = [(0, H - BOWL_DEPTH), (BOWL_BOT_R, H - BOWL_DEPTH), (HOLE_R - 1.0, H - 4), (BOWL_RIM_R, H + 0.3),
            (BOWL_RIM_R, H + 0.3 + t), (HOLE_R - 1.0 - t, H - 4 + t), (BOWL_BOT_R - t, H - BOWL_DEPTH + t),
            (0, H - BOWL_DEPTH + t)]
    return cq.Workplane("XZ").polyline(prof).close().revolve(360, (0, 0, 0), (0, 1, 0))


def make_feet():
    out = None
    for i in range(4):
        a = math.radians(45 + 90 * i)
        f = cq.Workplane("XY").circle(7).extrude(2.0).translate(((R_BOT - 10) * math.cos(a), (R_BOT - 10) * math.sin(a), -2.0))
        out = f if out is None else out.union(f)
    return out


def parts():
    return [
        {"name": "Bowl stand", "shape": make_stand(), "group": "case", "color": "#2a9d8f", "explode": [0, 0, -1]},
        {"name": "Stainless steel bowl, 1 qt", "shape": make_bowl(), "group": "component", "color": "#c0c6cc",
         "explode": [0, 0, 1]},
        {"name": "Rubber bumper feet (4x)", "shape": make_feet(), "group": "component", "color": "#222222",
         "explode": [0, 0, -1]},
    ]
