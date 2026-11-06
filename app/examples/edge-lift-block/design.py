"""Edge lift block for finger training: 20 mm and 14 mm edges, loaded through a 3/8 in eye bolt.

Z up, mm. Front (20 mm edge) faces -Y. The bolt carries the load; the plastic is only in
compression under the washer. Print on an X end (profile flat on the bed), 6 walls.
"""
import cadquery as cq

W = 110.0                 # block width (X) - room for 4 fingers
Y0, Y1 = -30.0, 30.0
H = 62.0
EDGE_Z = 44.0             # height of the edge surfaces
FRONT_EDGE = 20.0
BACK_EDGE = 14.0
EDGE_R = 6.0              # radius on the edge lips
BOLT_CLR = 10.2           # 3/8 in clearance
CB_D, CB_DEPTH = 23.0, 9.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


SPINE = (Y0 + FRONT_EDGE, Y1 - BACK_EDGE)


def make_block():
    # profile in YZ: base, two edges, rounded spine
    yf, yb = SPINE
    pts = [(Y0 + 8, 0), (Y1 - 8, 0), (Y1, 10), (Y1, EDGE_Z), (yb, EDGE_Z), (yb, H - 10),
           (yb - 6, H), (yf + 6, H), (yf, H - 10), (yf, EDGE_Z), (Y0, EDGE_Z), (Y0, 10)]
    b = cq.Workplane("YZ").polyline(pts).close().extrude(W).translate((-W / 2, 0, 0))
    b = try_fillet(b, "|X and >Z", 3.0)
    # round the two finger lips
    b = try_fillet(b, cq.selectors.BoxSelector((-W, Y0 - 1, EDGE_Z - 1), (W, Y0 + 1, EDGE_Z + 1)), EDGE_R)
    b = try_fillet(b, cq.selectors.BoxSelector((-W, Y1 - 1, EDGE_Z - 1), (W, Y1 + 1, EDGE_Z + 1)), EDGE_R)
    b = try_fillet(b, "<X or >X", 2.0)
    # bolt hole + counterbore for washer and nut in the spine top
    yc = (yf + yb) / 2
    b = b.cut(cq.Workplane("XY").center(0, yc).circle(BOLT_CLR / 2).extrude(H + 2).translate((0, 0, -1)))
    b = b.cut(cq.Workplane("XY").center(0, yc).circle(CB_D / 2).extrude(CB_DEPTH + 1).translate((0, 0, H - CB_DEPTH)))
    # hollow core from below (6 mm+ walls), solid boss round the bolt
    core = box(-W / 2 + 9, W / 2 - 9, -18, 18, -1, 30).cut(
        cq.Workplane("XY").center(0, yc).circle(11).extrude(40).translate((0, 0, -2)))
    b = b.cut(core)
    # thumb dimples on the ends for an optional pinch grip
    for sx in (-1, 1):
        b = b.cut(cq.Workplane("YZ").center(0, 30).ellipse(16, 11).extrude(3).translate((sx * W / 2 - (3 if sx > 0 else 0), 0, 0)))
    return b


def make_eyebolt():
    yc = (SPINE[0] + SPINE[1]) / 2
    shank = cq.Workplane("XY").center(0, yc).circle(4.75).extrude(100).translate((0, 0, -32))
    eye = cq.Workplane("XZ").center(0, -32 - 13).circle(13).circle(8).extrude(4.75).translate((0, yc + 2.4, 0))
    nut = cq.Workplane("XY").center(0, yc).polygon(6, 16.5).extrude(8).translate((0, 0, H - CB_DEPTH + 1.6))
    washer = cq.Workplane("XY").center(0, yc).circle(10.5).circle(5.2).extrude(1.6).translate((0, 0, H - CB_DEPTH))
    return shank.union(eye).union(nut).union(washer)


def make_carabiner():
    yc = (SPINE[0] + SPINE[1]) / 2
    return (cq.Workplane("YZ").center(yc, -78).ellipse(16, 30).ellipse(11, 25).extrude(10).translate((-5, 0, 0)))


def parts():
    return [
        {"name": "Edge block", "shape": make_block(), "group": "case", "color": "#f4a259", "explode": [0, 0, 1]},
        {"name": "3/8-16 x 4 in eye bolt + nut + washer", "shape": make_eyebolt(), "group": "component",
         "color": "#9aa0a6", "explode": [0, 0, -1]},
        {"name": "Locking carabiner", "shape": make_carabiner(), "group": "component", "color": "#3a86ff",
         "explode": [0, 0, -1]},
    ]
