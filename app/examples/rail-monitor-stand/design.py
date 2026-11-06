"""Rail monitor stand: a 2020 aluminium-extrusion frame, printed corner gussets and feet,
and a laser-cut 6 mm birch-plywood top with a cable notch.

Z up, mm, front faces -Y. Extrusions are cut to length and end-tapped M5; the gussets bolt on with
M5 button heads into drop-in T-nuts. The top screws down into T-nuts in the long rails.
"""
import cadquery as cq
from cadlib import fab

W, D = 600.0, 240.0          # top size
LEG_H = 100.0                # leg bar length
FOOT_T = 4.0                 # foot floor under the leg
RAIL_Z = FOOT_T + LEG_H      # bottom of the top frame
TOP_Z = RAIL_Z + 20.0        # top of the frame / underside of the plywood
TOP_T = 6.0
LX, LY = W / 2 - 10, D / 2 - 30    # leg centres (legs sit under the long rails)

THUMB_VIEW = "iso"


def gusset(sx, sy):
    """Printed L gusset on the inner face of a leg, under the long rail. sx, sy = +-1."""
    t, a = 5.0, 34.0
    x_face = sx * (LX - 10)            # inner face of the leg
    g = (cq.Workplane("XZ").polyline([(0, 0), (0, a), (a, a), (a, a - t), (t + 2, t + 2), (t, 0)]).close()
         .extrude(10).translate((0, 5, 0)))
    g = g.union(cq.Workplane("XZ").polyline([(0, 0), (0, a), (t, a)]).close().extrude(20).translate((0, 10, 0)))
    g = g.union(cq.Workplane("XZ").polyline([(0, a - t), (a, a - t), (a, a)]).close().extrude(20).translate((0, 10, 0)))
    try:
        g = g.edges("|Y").fillet(0.8)
    except Exception:
        pass
    hole = cq.Workplane("YZ").circle(2.75).extrude(t * 3).translate((-t, 0, a - 12))
    g = g.cut(hole)
    g = g.cut(cq.Workplane("XY").circle(2.75).extrude(t * 3).translate((a - 12, 0, a - t * 2)))
    # g's origin corner sits at (x_face, y, RAIL_Z - a); mirror for left legs
    g = g.translate((0, 0, -a))
    if sx > 0:
        g = g.mirror("YZ")
    return g.translate((x_face, sy * LY, RAIL_Z))


def foot(sx, sy):
    f = cq.Workplane("XY").rect(28, 28).extrude(FOOT_T + 10)
    try:
        f = f.edges("|Z").fillet(4).faces(">Z").edges().fillet(1.2)
    except Exception:
        pass
    f = f.cut(cq.Workplane("XY").rect(20.4, 20.4).extrude(20).translate((0, 0, FOOT_T)))
    return f.translate((sx * LX, sy * LY, 0))


def top():
    p = cq.Workplane("XY").rect(W, D).extrude(TOP_T)
    p = p.edges("|Z").fillet(10)
    p = p.cut(cq.Workplane("XY").center(0, D / 2).slot2D(120, 44, 0).extrude(TOP_T))   # cable notch at the back
    for x in (-W / 2 + 40, 0, W / 2 - 40):
        for y in (-LY, LY):
            p = p.cut(cq.Workplane("XY").center(x, y).circle(2.75).extrude(TOP_T))
            p = p.cut(cq.Workplane("XY").center(x, y).circle(5.0).extrude(3).translate((0, 0, TOP_T - 3)))
    return p.translate((0, 0, TOP_Z))


def parts():
    out = []
    for sy, nm in ((-1, "Front rail"), (1, "Back rail")):
        out.append({"name": nm, "shape": fab.extrusion(W, "2020", "x", at=(-W / 2, sy * LY, RAIL_Z + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": W}})
    for x, nm in ((-W / 2 + 10, "Left cross bar"), (0, "Middle cross bar"), (W / 2 - 10, "Right cross bar")):
        L = 2 * LY - 20
        out.append({"name": nm, "shape": fab.extrusion(L, "2020", "y", at=(x, -LY + 10, RAIL_Z + 10)),
                    "process": "extrusion", "params": {"profile": "2020", "length_mm": L}})
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append({"name": "Leg", "shape": fab.extrusion(LEG_H, "2020", "z", at=(sx * LX, sy * LY, FOOT_T)),
                        "process": "extrusion", "params": {"profile": "2020", "length_mm": LEG_H, "tapped_ends": 1},
                        "explode": [sx * 0.3, sy * 0.3, -0.6]})
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append({"name": "Corner gusset", "shape": gusset(sx, sy), "color": "#ff8a3d",
                        "explode": [-sx * 0.8, 0, -0.4]})
            out.append({"name": "Foot (TPU)", "shape": foot(sx, sy), "color": "#2b2f36", "explode": [0, 0, -1]})
    out.append({"name": "Plywood top", "shape": top(), "process": "laser", "color": "#d9b98a",
                "params": {"material": "birch plywood", "thickness_mm": TOP_T}, "explode": [0, 0, 1]})
    return out
