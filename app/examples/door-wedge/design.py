"""Door wedge with a grippy ribbed underside, finger pull and a hang hole.
Z up, mm, thin end faces -Y (slides under the door). Prints on its side - no supports.
"""
import cadquery as cq

L, W, H = 118.0, 42.0, 28.0
TIP = 2.5


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def make_wedge():
    prof = [(-L / 2, 0), (L / 2, 0), (L / 2, H), (L / 2 - 22, H), (-L / 2, TIP)]
    w = cq.Workplane("YZ").polyline(prof).close().extrude(W).translate((-W / 2, 0, 0))
    w = try_fillet(w, "|X", 1.2)
    w = try_fillet(w, "<X or >X", 1.5)
    # underside ribs (grip)
    for i in range(9):
        y = -L / 2 + 14 + i * 11
        w = w.cut(cq.Workplane("XY").box(W - 8, 4, 1.6).translate((0, y, 0.6)))
    # hang hole / finger pull through the thick end
    w = w.cut(cq.Workplane("YZ").center(L / 2 - 16, H * 0.55).slot2D(18, 11, 0).extrude(W + 2).translate((-W / 2 - 1, 0, 0)))
    # lightening pocket from the side
    w = w.cut(cq.Workplane("YZ").polyline([(-L / 2 + 30, 3.5), (L / 2 - 32, 3.5),
                                            (L / 2 - 32, H - 9), (-L / 2 + 30, 3.5 + (H - 9 - 3.5) * 0.35)]).close()
              .extrude(W - 6).translate((-W / 2 + 3, 0, 0)))
    return w


def make_pads():
    return cq.Workplane("XY").box(W - 10, 50, 1.2).translate((0, -10, -0.6))


def parts():
    return [
        {"name": "Door wedge", "shape": make_wedge(), "group": "case", "color": "#ef476f", "explode": [0, 0, 1]},
        {"name": "Silicone anti-slip pad", "shape": make_pads(), "group": "component", "color": "#333333",
         "explode": [0, 0, -1]},
    ]
