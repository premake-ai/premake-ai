"""Guyline tensioner kit: six three-hole cord tensioners and a cord winder for tents, tarps and
hammock rigs. Organic tapered sliders with chamfered holes that won't fray the line; print them
in glow-in-the-dark PETG so you stop tripping over guylines at night. Hole size and plate
thickness are parameters for 2.5-5 mm cord.

Z up, mm, front faces -Y. Every part is a flat plate: prints on the bed as modelled, no supports.
"""
import cadquery as cq

P = {
    "cord": 4.0,            # cord diameter
    "length": 46.0, "w_big": 17.0, "w_small": 13.0, "thick": 4.6,
    "count": 6,
    "winder_l": 74.0, "winder_w": 34.0, "winder_t": 4.0,
}
C_GLOW, C_WINDER = "#c8f7c5", "#ff9f1c"


def outline(L, a, b, t):
    """Tapered 'bone' plate: hull of two circles (diam a at -X, diam b at +X)."""
    xa, xb = -L / 2 + a / 2, L / 2 - b / 2
    s = (cq.Workplane("XY").moveTo(xa, a / 2).lineTo(xb, b / 2)
         .threePointArc((L / 2, 0), (xb, -b / 2)).lineTo(xa, -a / 2)
         .threePointArc((-L / 2, 0), (xa, a / 2)).close().extrude(t))
    return s


def tensioner():
    L, a, b, t = P["length"], P["w_big"], P["w_small"], P["thick"]
    s = outline(L, a, b, t)
    try:
        s = s.faces(">Z or <Z").edges().fillet(1.4)
    except Exception:
        pass
    hd = P["cord"] + 1.0
    xs = [-L / 2 + a / 2, -L / 2 + a / 2 + hd + 6.0, L / 2 - b / 2]
    for x in xs:
        s = s.cut(cq.Workplane("XY").center(x, 0).circle(hd / 2).extrude(t + 2).translate((0, 0, -1)))
        for z, flip in ((t, 1), (0, -1)):   # chamfered hole mouths (no fraying)
            cone = (cq.Workplane("XY").circle(hd / 2 + 0.9).workplane(offset=0.9 * -flip).circle(hd / 2).loft()
                    .translate((x, 0, z)))
            s = s.cut(cone)
    return s


def winder():
    L, W, t = P["winder_l"], P["winder_w"], P["winder_t"]
    s = cq.Workplane("XY").rect(L, W).extrude(t)
    try:
        s = s.edges("|Z").fillet(8.0)
    except Exception:
        pass
    # end notches the cord wraps between
    for sx in (-1, 1):
        s = s.cut(cq.Workplane("XY").center(sx * L / 2, 0).slot2D(26, 12, 0).extrude(t + 2).translate((0, 0, -1)))
    # centre window + cord-lock slit
    s = s.cut(cq.Workplane("XY").slot2D(30, 9, 0).extrude(t + 2).translate((0, 0, -1)))
    s = s.cut(cq.Workplane("XY").center(0, W / 2 - 2).rect(2.2, 9).extrude(t + 2).translate((0, 0, -1)))
    try:
        s = s.faces(">Z or <Z").edges().fillet(1.2)
    except Exception:
        pass
    return s


def parts():
    out = []
    n = P["count"]
    for i in range(n):
        col, row = i % 3, i // 3
        x = -50 + col * 26.0
        y = -22 + row * 52.0
        t = tensioner().rotate((0, 0, 0), (0, 0, 1), 90 if row == 0 else -90).translate((x, y, 0))
        out.append({"name": f"Tensioner {i + 1}", "shape": t, "group": "case", "color": C_GLOW, "explode": [0, 0, 1]})
    out.append({"name": "Cord winder", "shape": winder().rotate((0, 0, 0), (0, 0, 1), 90).translate((40, 4, 0)),
                "group": "case", "color": C_WINDER, "explode": [1, 0, 0]})
    return out
