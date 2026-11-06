"""Arc desk lamp: weighted base, swept arc arm with a cable groove, and a head that holds a
17 mm aluminium LED channel with a USB 5 V LED strip.

Z up, mm, the head points to -Y (over the desk). Print base flat, arm on its side, head upside down.
"""
import cadquery as cq

BASE_R, BASE_H = 62.0, 16.0
BASE_C = (0.0, 22.0)
ARM_W, ARM_T = 22.0, 15.0
P0 = (32.0, BASE_H - 6)            # arm start (y, z), sunk into a socket in the base
P_MID = (22.0, 200.0)
P1 = (-96.0, 232.0)
HEAD_C = (-104.0, 226.0)
HEAD_L, HEAD_W, HEAD_H = 200.0, 30.0, 16.0
CH_W, CH_H = 17.6, 8.0             # LED channel slot


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def arm_path():
    return cq.Workplane("YZ").spline([P0, P_MID, P1], tangents=[(0, 1), (-0.55, -0.83)], includeCurrent=False)


def make_arm():
    prof = (cq.Workplane("XY").workplane(offset=P0[1]).center(0, P0[0])
            .sketch().rect(ARM_W, ARM_T).vertices().fillet(4.0).finalize())
    return prof.sweep(arm_path(), transition="round")


def make_base():
    b = cq.Workplane("XY").circle(BASE_R).extrude(BASE_H).translate((BASE_C[0], BASE_C[1], 0))
    try:
        b = b.faces(">Z").edges().fillet(8.0).faces("<Z").edges().fillet(1.5)
    except Exception:
        pass
    # arm socket (the arm itself is the cutter, so the fit always matches)
    b = b.cut(make_arm())
    # weight pocket underneath (stack of 2 in fender washers) + cable exit
    b = b.cut(cq.Workplane("XY").circle(26.5).extrude(8.4).translate((BASE_C[0], BASE_C[1] - 14, 0)))
    b = b.cut(box(-4, 4, P0[0], BASE_C[1] + BASE_R + 1, 0, 6))
    # lightening ring underneath
    b = b.cut(cq.Workplane("XY").circle(55).circle(43).extrude(9).translate((BASE_C[0], BASE_C[1], 0)))
    # dimmer recess on top
    b = b.cut(cq.Workplane("XY").center(0, BASE_C[1] - 30).slot2D(40, 16, 0).extrude(3).translate((0, 0, BASE_H - 3)))
    return b


def make_head():
    cy, cz = HEAD_C
    h = box(-HEAD_L / 2, HEAD_L / 2, cy - HEAD_W / 2, cy + HEAD_W / 2, cz - HEAD_H / 2, cz + HEAD_H / 2)
    try:
        h = h.edges("|X").fillet(6.0).edges("|Y").fillet(4.0)
    except Exception:
        pass
    h = h.cut(box(-HEAD_L / 2 + 6, HEAD_L / 2 - 6, cy - CH_W / 2, cy + CH_W / 2, cz - HEAD_H / 2 - 1,
                  cz - HEAD_H / 2 + CH_H))
    h = h.cut(make_arm())
    # vent slots on top
    for i in range(-6, 7):
        if abs(i) < 3:
            continue
        x = i * 12.0
        h = h.cut(box(x - 2, x + 2, cy - 8, cy + 8, cz + HEAD_H / 2 - 2, cz + HEAD_H / 2 + 1))
    return h


def make_led():
    cy, cz = HEAD_C
    ch = box(-HEAD_L / 2 + 7, HEAD_L / 2 - 7, cy - CH_W / 2 + 0.3, cy + CH_W / 2 - 0.3,
             cz - HEAD_H / 2 - 0.5, cz - HEAD_H / 2 + CH_H - 0.3)
    return ch


def make_weights():
    out = None
    for k in range(4):
        w = cq.Workplane("XY").circle(25.4).circle(4.0).extrude(1.9).translate((BASE_C[0], BASE_C[1] - 14, 0.3 + k * 2.0))
        out = w if out is None else out.union(w)
    return out


def make_dimmer():
    return (cq.Workplane("XY").center(0, BASE_C[1] - 30).slot2D(38, 14, 0).extrude(8)
            .translate((0, 0, BASE_H - 2.8)).edges(">Z").fillet(2))


def parts():
    return [
        {"name": "Lamp base", "shape": make_base(), "group": "case", "color": "#22223b", "explode": [0, 0, -1]},
        {"name": "Arc arm", "shape": make_arm(), "group": "case", "color": "#f2e9e4", "explode": [0, 0.4, 0.3]},
        {"name": "Lamp head", "shape": make_head(), "group": "case", "color": "#22223b", "explode": [0, -0.6, 1]},
        {"name": "Aluminium LED channel + USB LED strip", "shape": make_led(), "group": "component",
         "color": "#fff3b0", "explode": [0, 0, -1]},
        {"name": "2 in fender washers (weight, 4x)", "shape": make_weights(), "group": "component",
         "color": "#9aa0a6", "explode": [0, 0, -1]},
        {"name": "Inline USB dimmer", "shape": make_dimmer(), "group": "component", "color": "#4a4e69",
         "explode": [0, 0, 1]},
    ]
