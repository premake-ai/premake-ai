import cadquery as cq
import math

SCENE = "floor"

BASE_D, BASE_H = 96, 170
TUBES = [(25, 140), (22, 380), (19, 620), (16, 860)]  # (OD, bottom z), 300 mm each
TUBE_L = 300
HEAD_W, HEAD_D, HEAD_H = 150, 50, 80
HEAD_Z = 1240


def parts():
    out = []
    base = cq.Workplane("XY").circle(BASE_D / 2).extrude(BASE_H)
    out.append({"name": "Base shell", "shape": base, "color": "#2b3a2f"})
    for i, (od, z) in enumerate(TUBES):
        t = cq.Workplane("XY").circle(od / 2).circle(od / 2 - 1).extrude(TUBE_L).translate((0, 0, z))
        out.append({"name": f"Tube {i+1}", "shape": t, "group": "component", "color": "#b8bcc2"})
    for k in range(3):
        a = 90 + k * 120
        leg = cq.Workplane("XY").box(160, 20, 8).translate((53 + 80, 0, 4)).rotate((0, 0, 0), (0, 0, 1), a)
        out.append({"name": f"Leg {k+1}", "shape": leg, "color": "#2b3a2f"})
    head = cq.Workplane("XY").box(HEAD_W, HEAD_D, HEAD_H).translate((0, 0, HEAD_Z))
    out.append({"name": "Head shell", "shape": head, "color": "#2b3a2f"})
    return out
