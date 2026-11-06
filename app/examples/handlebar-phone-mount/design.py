"""Handlebar phone mount: a cradle sized to YOUR phone (in its case), a saddle that slides onto a
dovetail on the cradle back, and two TPU parts: a stretch strap that wraps the bar and hooks over
barbs on the saddle, and a top band that pins the phone. No tools, no metal, swaps bikes in seconds.

Z up, mm, front (screen side, toward the rider) faces -Y. Bar runs along X.
Prints: cradle back-down; saddle on its side (profile on the bed); TPU parts flat. No supports.
"""
import math
import cadquery as cq

P = {
    "phone_w": 78.0, "phone_l": 162.0, "phone_t": 10.0,   # with case: measure yours
    "bar_d": 31.8,           # 22.2 / 25.4 / 31.8 / 35
    "tilt": 22.0,            # cradle tilt toward the rider
    "plate_w": 64.0, "plate_l": 112.0, "plate_t": 5.5,
    "saddle_w": 30.0,
    "strap_w": 18.0, "strap_t": 2.4,
}
C_CRADLE, C_SADDLE, C_TPU = "#3d405b", "#81b29a", "#e07a5f"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def fil(s, sel, r):
    try:
        return s.edges(sel).fillet(r)
    except Exception:
        return s


def frame():
    rb = P["bar_d"] / 2
    r_out = rb + 0.3 + 3.8
    zc = r_out + 13.0
    return rb, r_out, zc


def to_world(s):
    _, _, zc = frame()
    return s.rotate((0, 0, 0), (1, 0, 0), P["tilt"]).translate((0, 0, zc))


def dovetail(w_face, depth, length, grow=0.0):
    """Trapezoid in local YZ (narrow at z=0, wide at z=-depth), extruded along X, centred."""
    a = w_face / 2 + grow
    b = a + depth * 0.7
    return (cq.Workplane("YZ").polyline([(-a, 0.01), (-b, -depth), (b, -depth), (a, 0.01)]).close()
            .extrude(length).translate((-length / 2, 0, 0)))


def cradle_local():
    W, L, t = P["plate_w"], P["plate_l"], P["plate_t"]
    pw, pl, pt = P["phone_w"], P["phone_l"], P["phone_t"]
    y0 = -L / 2                       # phone bottom edge sits here
    p = (cq.Workplane("XY").polyline([(-W / 2, -L / 2), (W / 2, -L / 2), (W * 0.36, L / 2), (-W * 0.36, L / 2)])
         .close().extrude(t))
    p = fil(p, "|Z", 14.0)
    p = fil(p, ">Z", 1.6)
    # corner cups for the phone's bottom corners
    wall = 2.6
    for sx in (-1, 1):
        x_in, x_out = sx * (pw / 2 - 16), sx * (pw / 2 + wall)
        cup = box(min(x_in, x_out), max(x_in, x_out), y0 - wall, y0 + 18, 0, t + pt + 1.5)
        cup = fil(cup, "|Z", 4.0)
        cup = fil(cup, ">Z", 1.0)
        cup = cup.cut(box(-pw / 2, pw / 2, y0, y0 + 40, t, t + pt + 3))
        cup = cup.cut(box(-pw / 2 + 4, pw / 2 - 4, y0 - 10, y0 + 40, t + 3.0, t + pt + 3))
        p = p.union(cup)
    # cable / port notch between the cups
    p = p.cut(box(-12, 12, y0 - 4, y0 + 6, -1, t + 1))
    # top band posts with conical (support-free) heads
    yb = L / 2 - 12
    for sx in (-1, 1):
        x = sx * (pw / 2 + 2.5)
        post = cq.Workplane("XY").circle(3.5).extrude(t + pt + 2).translate((x, yb, 0))
        head = (cq.Workplane("XY").circle(3.5).workplane(offset=2.2).circle(5.5).loft()
                .translate((x, yb, t + pt + 2)))
        head = head.union(cq.Workplane("XY").circle(5.5).extrude(1.2).translate((x, yb, t + pt + 4.2)))
        ear = box(min(x, sx * W / 2 - sx * 6), max(x, sx * W / 2 - sx * 6), yb - 7, yb + 7, 0, t)
        ear = fil(ear, "|Z", 3.0)
        p = p.union(ear).union(post).union(head)
    # lightening windows
    for yy in (-14.0, 22.0):
        p = p.cut(cq.Workplane("XY").center(0, yy).slot2D(30, 16, 0).extrude(t + 2).translate((0, 0, -1)))
    # dovetail slot in the back (slides onto the saddle along X)
    p = p.cut(dovetail(14.0, 2.8, W + 30, grow=0.2).rotate((0, 0, 0), (0, 1, 0), 180).translate((0, 4.0, 0)))
    return p


def saddle():
    rb, r_out, zc = frame()
    w = P["saddle_w"]
    r_in = rb + 0.3
    arch = cq.Workplane("YZ").circle(r_out).circle(r_in).extrude(w).translate((-w / 2, 0, 0))
    arch = arch.cut(box(-w, w, -r_out - 1, r_out + 1, -r_out - 1, 4.0))
    # pedestal up to the cradle back, with the dovetail tongue on top (all a YZ profile)
    ped = to_world(box(-w / 2, w / 2, -6.0, 14.0, -24.0, 0).union(
        dovetail(13.6, 2.6, w).rotate((0, 0, 0), (0, 1, 0), 180).translate((0, 4.0, 0))))
    ped = ped.cut(cq.Workplane("YZ").circle(r_out - 0.5).extrude(w + 2).translate((-w / 2 - 1, 0, 0)))
    s = arch.union(ped)
    # strap barbs on both sides
    for sy in (-1, 1):
        yb = sy * (r_out + 0.0)
        barb = (cq.Workplane("YZ").polyline([(yb, 4.0), (yb + sy * 6.5, 4.0), (yb + sy * 6.5, 9.5),
                                              (yb + sy * 4.5, 9.5), (yb + sy * 4.5, 7.0), (yb, 7.0)]).close()
                .extrude(w).translate((-w / 2, 0, 0)))
        s = s.union(barb)
    s = fil(s, "|X", 0.8)
    return s


def strap():
    """TPU stretch strap: wraps under the bar, tails rise to the saddle barbs, slotted pull tabs."""
    rb, r_out, _ = frame()
    sw, st = P["strap_w"], P["strap_t"]
    ring = cq.Workplane("YZ").circle(rb + st).circle(rb).extrude(sw).translate((-sw / 2, 0, 0))
    s = ring.cut(box(-sw, sw, -rb - 5, rb + 5, 0, rb + 5))
    for sy in (-1, 1):
        y0, y1 = rb + st / 2, r_out + 5.5
        z0, z1 = 0.0, 9.5 + st / 2
        ln = math.hypot(y1 - y0, z1 - z0)
        ang = math.degrees(math.atan2(z1 - z0, y1 - y0))
        tail = box(-sw / 2, sw / 2, 0, ln, -st / 2, st / 2).rotate((0, 0, 0), (1, 0, 0), ang).translate((0, y0, z0))
        tab = box(-sw / 2, sw / 2, r_out + 4.0, r_out + 16.0, 9.5, 9.5 + st)
        tab = fil(tab, "|Z and >Y", 4.0)
        tab = tab.cut(box(-w_slot(sw), w_slot(sw), r_out + 4.2, r_out + 7.0, 0, 20))
        part = tail.union(tab)
        if sy < 0:
            part = part.mirror("XZ")
        s = s.union(part)
    return s


def w_slot(sw):
    return sw / 2 - 3.0


def band_local():
    pw, t, pt = P["phone_w"], P["plate_t"], P["phone_t"]
    yb = P["plate_l"] / 2 - 12
    z = t + pt + 0.2
    b = box(-pw / 2 - 2.5, pw / 2 + 2.5, yb - 6, yb + 6, z, z + 2.0)
    for sx in (-1, 1):
        x = sx * (pw / 2 + 2.5)
        b = b.union(cq.Workplane("XY").circle(7.0).extrude(2.0).translate((x, yb, z)))
        b = b.cut(cq.Workplane("XY").circle(3.4).extrude(4.0).translate((x, yb, z - 1)))
    return b


def bar():
    rb = P["bar_d"] / 2
    return cq.Workplane("YZ").circle(rb).extrude(220).translate((-110, 0, 0))


def parts():
    return [
        {"name": "Phone cradle", "shape": to_world(cradle_local()), "group": "case", "color": C_CRADLE, "explode": [0, 0, 1]},
        {"name": "Bar saddle", "shape": saddle(), "group": "case", "color": C_SADDLE, "explode": [0, 0, 0.2]},
        {"name": "Bar strap (TPU)", "shape": strap(), "group": "case", "color": C_TPU, "explode": [0, 0, -1]},
        {"name": "Phone band (TPU)", "shape": to_world(band_local()), "group": "case", "color": C_TPU, "explode": [0, -0.4, 1]},
        {"name": "Handlebar (not included)", "shape": bar(), "group": "component", "color": "#b0b4ba", "explode": [0, 0, 0]},
    ]
