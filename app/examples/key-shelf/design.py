"""Entryway key shelf: wall plate with 4 carabiner pegs and a small tray for wallet / earbuds.

Z up, mm, wall at +Y (back face y = 0), front -Y. Print on its back - no supports.
"""
import cadquery as cq

W, H, T = 200.0, 104.0, 4.5
TRAY_D, TRAY_LIP = 46.0, 16.0
PEG_Z = 30.0
PEG_XS = [-66.0, -22.0, 22.0, 66.0]


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def try_fillet(wp, sel, r):
    try:
        out = wp.edges(sel).fillet(r)
        return out if out.val().isValid() else wp
    except Exception:
        return wp


def make_shelf():
    p = try_fillet(box(-W / 2, W / 2, -T, 0, 0, H), "|Y", 10.0)
    p = try_fillet(p, "<Y", 2.0)
    # tray across the top
    tray = box(-W / 2 + 4, W / 2 - 4, -T - TRAY_D, -T + 0.5, H - 30, H - 26)
    lip = box(-W / 2 + 4, W / 2 - 4, -T - TRAY_D, -T - TRAY_D + 4, H - 30, H - 30 + TRAY_LIP)
    ends = [box(s * (W / 2 - 4) - (4 if s > 0 else 0), s * (W / 2 - 4) + (0 if s > 0 else 4),
                -T - TRAY_D, -T + 0.5, H - 30, H - 30 + TRAY_LIP) for s in (-1, 1)]
    t = tray.union(lip).union(ends[0]).union(ends[1])
    t = try_fillet(t, "|Z", 3.0)
    p = p.union(t)
    gus = [cq.Workplane("YZ").polyline([(-T, H - 30), (-T - 30, H - 30), (-T, H - 62)]).close()
           .extrude(5).translate((x - 2.5, 0, 0)) for x in (-60.0, 60.0)]
    for g in gus:
        p = p.union(g)
    # pegs with a retaining lip
    for x in PEG_XS:
        peg = cq.Workplane("XZ").center(x, PEG_Z).circle(4.5).extrude(28).translate((0, -T + 0.5, 0))
        knob = cq.Workplane("XZ").center(x, PEG_Z + 2).circle(6.0).extrude(4).translate((0, -T - 27.5, 0))
        p = p.union(peg).union(try_fillet(knob, "<Y", 1.5))
    # 2 countersunk screw holes
    for x in (-80.0, 80.0):
        p = p.cut(cq.Workplane("XZ").center(x, 55).circle(2.3).extrude(-T - 2).translate((0, -T - 1, 0)))
        p = p.cut(cq.Workplane("XY").add(cq.Solid.makeCone(4.8, 2.3, 2.5, cq.Vector(x, -T - 0.01, 55),
                                                            cq.Vector(0, 1, 0))))
    # small cable slot in tray floor for a charging cable
    p = p.cut(box(-6, 6, -T - 6, -T + 0.4, H - 31, H - 25))
    return p


def make_carabiners():
    out = None
    for i, x in enumerate(PEG_XS):
        ring = (cq.Workplane("XZ").ellipse(11.0, 19.0).ellipse(7.5, 15.5).extrude(4.0)
                .translate((x, -T - 12, PEG_Z + 4.5 - 15.5)))
        ring = ring.edges().fillet(1.0) if True else ring
        out = ring if out is None else out.union(ring)
    return out


def make_keys():
    out = None
    for x in PEG_XS[:3]:
        k = (cq.Workplane("XZ").center(x, PEG_Z - 44).rect(12, 44).extrude(2.2)
             .union(cq.Workplane("XZ").center(x, PEG_Z - 22).circle(11).extrude(2.2))
             .translate((0, -T - 11, 0)))
        out = k if out is None else out.union(k)
    return out


def parts():
    return [
        {"name": "Key shelf", "shape": make_shelf(), "group": "case", "color": "#e9e4d8", "explode": [0, 1, 0]},
        {"name": "Mini carabiners (4x)", "shape": make_carabiners(), "group": "component",
         "color": "#ff5a5f", "explode": [0, -1, 0]},
        {"name": "Keys (not included)", "shape": make_keys(), "group": "component",
         "color": "#c7a750", "explode": [0, -1, -0.5]},
    ]
