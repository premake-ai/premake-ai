"""Fold-flat phone stand: ONE print-in-place part. The back leaf nests inside the base and the
strut nests behind it, both on printed axle hinges, so it prints as a flat 5.5 mm plate and
folds back flat for a pocket or bag. Open, the strut tip drops into one of three V-notches on
the back of the leaf for three viewing angles. A slot through the front lip passes a cable.

Modelled open at the middle notch. Z up, mm, front faces -Y. Print flat as one plate:
0.6 mm gaps around the nested leaves, 0.35 mm radial axle clearance, no supports.
"""
import math
import cadquery as cq

P = {
    "width": 74.0,          # base width
    "t": 5.5,               # plate thickness (= folded thickness)
    "leaf_w": 54.0, "leaf_len": 96.0,
    "strut_w": 38.0,
    "hinge_y": 20.0,        # leaf axle position from the front lip
    "angle": 62.0,          # leaf angle from the desk at the middle notch
    "notches": [40.0, 46.0, 52.0],   # strut notch positions along the leaf (middle one modelled)
    "lip_h": 15.0,
    "gap": 0.6, "axle_r": 1.5, "axle_clear": 0.35,
}
C_BASE, C_LEAF, C_STRUT = "#5b3fd6", "#8f7bff", "#3e2a9c"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def xcyl(r, x0, x1, y, z):
    return cq.Workplane("YZ").circle(r).extrude(x1 - x0).translate((x0, y, z))


def fil(s, sel, r):
    try:
        return s.edges(sel).fillet(r)
    except Exception:
        return s


def geom():
    t = P["t"]
    a = math.radians(P["angle"])
    u, n = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    A = (P["hinge_y"], t / 2)
    s = P["notches"][1]
    tip = (A[0] + s * u[0] - (t / 2) * n[0], A[1] + s * u[1] - (t / 2) * n[1])
    y2 = A[0] + P["leaf_len"] + P["gap"] + 5.0 + t / 2 + P["gap"]    # strut axle
    B = (y2, t / 2)
    dy, dz = tip[0] - B[0], tip[1] - B[1]
    ls = math.hypot(dy, dz)
    return A, B, ls, math.degrees(math.atan2(dz, dy))


def base():
    W, t, g = P["width"], P["t"], P["gap"]
    A, B, ls, _ = geom()
    L = B[0] + ls + g + 9.0
    b = box(-W / 2, W / 2, 0, L, 0, t)
    b = fil(b, "|Z", 9.0)
    lw, sw = P["leaf_w"] / 2 + g, P["strut_w"] / 2 + g
    b = b.cut(box(-lw, lw, A[0] - t / 2 - g, A[0] + P["leaf_len"] + g, -1, t + 1))
    b = b.cut(box(-sw, sw, B[0] - t / 2 - g, B[0] + ls + g, -1, t + 1))
    # axle bores in the rails
    for (cx, w) in ((A, lw), (B, sw)):
        b = b.cut(xcyl(P["axle_r"] + P["axle_clear"], -w - 4.5, w + 4.5, cx[0], cx[1]))
    # front lip with a cable slot
    lip = box(-W / 2, W / 2, 0, 5.0, 0, P["lip_h"])
    lip = fil(lip, ">Z", 2.4)
    b = b.union(lip)
    b = b.cut(box(-6, 6, -1, 7, t - 0.5, P["lip_h"] + 1))
    b = b.cut(box(-6, 6, -1, A[0] - t / 2 - g, -1, t + 1))
    # rear rail lightening windows
    for sx in (-1, 1):
        cx = sx * (sw + (W / 2 - sw) / 2)
        b = b.cut(cq.Workplane("XY").center(cx, B[0] + ls * 0.5).slot2D(ls * 0.62, 6.5, 90).extrude(t + 2).translate((0, 0, -1)))
    b = fil(b, ">Z", 0.8)
    return b


def leaf():
    t, g = P["t"], P["gap"]
    A, _, _, _ = geom()
    w, L = P["leaf_w"] / 2, P["leaf_len"]
    f = box(-w, w, 0, L, -t / 2, t / 2)
    f = fil(f, "|Z and >Y", 8.0)
    f = f.cut(box(-w - 1, w + 1, -t, 0, -t, t)).union(xcyl(t / 2, -w, w, 0, 0))      # round hinge end
    f = f.union(xcyl(P["axle_r"], -w - 4.0, w + 4.0, 0, 0))                          # print-in-place axles
    f = f.cut(cq.Workplane("XY").center(0, L * 0.765).slot2D(L * 0.27, 22, 90).extrude(t + 2).translate((0, 0, -t / 2 - 1)))
    for s in P["notches"]:                                                           # V notches on the back
        v = (cq.Workplane("YZ").moveTo(s - 2.2, -t / 2 - 0.01).lineTo(s, -t / 2 + 2.0)
             .lineTo(s + 2.2, -t / 2 - 0.01).close().extrude(P["strut_w"] + 4).translate((-P["strut_w"] / 2 - 2, 0, 0)))
        f = f.cut(v)
    f = fil(f, ">Z", 0.8)
    return f.rotate((0, 0, 0), (1, 0, 0), P["angle"]).translate((0, A[0], A[1]))


def strut():
    t = P["t"]
    _, B, ls, psi = geom()
    w = P["strut_w"] / 2
    s = box(-w, w, 0, ls, -t / 2, t / 2)
    s = s.cut(box(-w - 1, w + 1, -t, 0, -t, t)).union(xcyl(t / 2, -w, w, 0, 0))
    s = s.cut(box(-w - 1, w + 1, ls - 2.0, ls + 1, -t, t)).union(xcyl(2.0, -w, w, ls - 2.0, t / 2 - 2.0))
    s = s.union(xcyl(P["axle_r"], -w - 4.0, w + 4.0, 0, 0))
    s = s.cut(cq.Workplane("XY").center(0, ls * 0.5).slot2D(ls * 0.55, 14, 90).extrude(t + 2).translate((0, 0, -t / 2 - 1)))
    return s.rotate((0, 0, 0), (1, 0, 0), psi).translate((0, B[0], B[1]))


def parts():
    return [
        {"name": "Fold-flat stand (print-in-place): base", "shape": base(), "group": "case", "color": C_BASE, "explode": [0, 0, -1]},
        {"name": "Fold-flat stand (print-in-place): leaf", "shape": leaf(), "group": "case", "color": C_LEAF, "explode": [0, -0.6, 0.6]},
        {"name": "Fold-flat stand (print-in-place): strut", "shape": strut(), "group": "case", "color": C_STRUT, "explode": [0, 1, 0.4]},
    ]
