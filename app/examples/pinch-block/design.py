"""Pinch block: a climbing / grip-strength pinch trainer you lift off the floor with weight hung below.

The body is a windowed I-beam (two grip cheeks, a central spine carrying an M8 eye bolt, top and
bottom caps), so it prints fast with full-strength load paths. Snap-on width shims slide up a
dovetail rail on each cheek: print as many widths as you like, swap them in seconds.

Z up, mm, front faces -Y. Prints standing upright, dovetails vertical, window tops arched: no supports.
"""
import cadquery as cq

P = {
    "pinch_w": 42.0,      # body width across the grip faces (no shims)
    "depth": 34.0,        # front-to-back
    "height": 78.0,
    "cheek_t": 4.0,       # grip cheek thickness
    "cap_t": 6.0,         # top / bottom cap thickness
    "spine_d": 13.0,      # spine around the bolt
    "bolt_d": 8.6,        # M8 clearance
    "shim_t": 4.5,        # each shim adds this per side
    "dovetail_w": 10.0,   # dovetail rail width at the face
    "edge_r": 5.0,
}
THUMB_VIEW = "iso"


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def rounded_slab(w, d, h, r):
    s = box(-w / 2, w / 2, -d / 2, d / 2, 0, h)
    try:
        s = s.edges("|Z").fillet(r)
    except Exception:
        pass
    return s


def dovetail_profile(depth, wide, narrow):
    """Trapezoid in XY: narrow at x=0 (the face), wide at x=-depth (inside). Extruded along Z."""
    return (cq.Workplane("XY").moveTo(0, -narrow / 2).lineTo(-depth, -wide / 2)
            .lineTo(-depth, wide / 2).lineTo(0, narrow / 2).close())


def body():
    W, D, H, ct, cap = P["pinch_w"], P["depth"], P["height"], P["cheek_t"], P["cap_t"]
    b = rounded_slab(W, D, H, P["edge_r"])
    # through-windows front to back, either side of the spine, arched (pointed) tops for bridging
    inner = W / 2 - ct
    sx0, sx1 = P["spine_d"] / 2, inner
    win_w = sx1 - sx0
    for sgn in (-1, 1):
        cx = sgn * (sx0 + sx1) / 2
        z0, z1 = cap, H - cap - win_w / 2
        win = (cq.Workplane("XZ").moveTo(cx - win_w / 2, z0).lineTo(cx + win_w / 2, z0)
               .lineTo(cx + win_w / 2, z1).lineTo(cx, z1 + win_w / 2).lineTo(cx - win_w / 2, z1).close()
               .extrude(D / 2 + 1, both=True))
        b = b.cut(win)
    # bolt bore + recessed nut pocket on top
    b = b.cut(cq.Workplane("XY").circle(P["bolt_d"] / 2).extrude(H + 2).translate((0, 0, -1)))
    b = b.cut(cq.Workplane("XY").polygon(6, 15.2).extrude(7).translate((0, 0, H - 6.5)))
    # dovetail grooves up each cheek face, open at the bottom, closed 6 mm below the top
    dt_d = 2.4
    for sgn in (-1, 1):
        g = dovetail_profile(dt_d, P["dovetail_w"] + 2 * dt_d * 0.8 + 0.4, P["dovetail_w"] + 0.4).extrude(H - 6 + 1)
        g = g.translate((0, 0, -1))
        if sgn < 0:
            g = g.mirror("YZ")
        b = b.cut(g.translate((sgn * W / 2, 0, 0)))
    # detent dimples at the top of each groove (the shim nub clicks in here)
    for sgn in (-1, 1):
        b = b.cut(cq.Workplane("YZ").circle(1.0).extrude(1.2).translate((W / 2 - dt_d - 1.0, 0, H - 12)).mirror("YZ") if sgn < 0
                  else cq.Workplane("YZ").circle(1.0).extrude(1.2).translate((W / 2 - dt_d - 1.0, 0, H - 12)))
    try:
        b = b.faces(">Z or <Z").edges().fillet(1.5)
    except Exception:
        pass
    return b


def shim(sgn):
    W, D, H, t = P["pinch_w"], P["depth"], P["height"], P["shim_t"]
    dt_d = 2.4
    s = rounded_slab(t, D, H - 6, 2.0).translate((t / 2, 0, 0))
    # grip texture: shallow horizontal grooves on the outer face
    for z in range(8, int(H - 12), 6):
        s = s.cut(box(t - 0.7, t + 1, -D / 2 + 3, D / 2 - 3, z, z + 2.0))
    try:
        s = s.faces(">Z or <Z").edges().chamfer(1.2)
    except Exception:
        pass
    tongue = dovetail_profile(dt_d - 0.25, P["dovetail_w"] + 2 * (dt_d - 0.25) * 0.8, P["dovetail_w"]).extrude(H - 6)
    s = s.union(tongue)
    s = s.union(cq.Workplane("YZ").circle(0.7).extrude(0.8).translate((-(dt_d - 0.25) - 0.6, 0, H - 12)))   # snap nub
    if sgn < 0:
        s = s.mirror("YZ")
    return s.translate((sgn * W / 2, 0, 0))


def eye_bolt():
    H = P["height"]
    shank = cq.Workplane("XY").circle(4).extrude(H + 4).translate((0, 0, -6))
    eye = cq.Workplane("XZ").center(0, -18).circle(13).circle(8).extrude(3, both=True)
    nut = cq.Workplane("XY").polygon(6, 14.7).circle(4).extrude(6.5).translate((0, 0, H - 6.5))
    collar = cq.Workplane("XY").circle(9).extrude(4).translate((0, 0, -6))
    return shank.union(eye).union(nut).union(collar)


def parts():
    return [
        {"name": "Pinch block body", "shape": body(), "group": "case", "color": "#e4572e", "explode": [0, 0, 0]},
        {"name": "Width shim left", "shape": shim(-1), "group": "case", "color": "#2d3047", "explode": [-1, 0, 0]},
        {"name": "Width shim right", "shape": shim(1), "group": "case", "color": "#2d3047", "explode": [1, 0, 0]},
        {"name": "M8 x 100 eye bolt + nyloc", "shape": eye_bolt(), "group": "component", "color": "#9aa0a6",
         "explode": [0, 0, -1]},
    ]
