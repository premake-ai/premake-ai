"""Cable dock: weighted desk block that holds 5 charging cables in snap-in channels.

Z up, mm, front faces -Y. Prints flat on its base, no supports (channels are teardrop-free
because the snap opening is on top).
"""
import cadquery as cq

L, D, H = 112.0, 34.0, 24.0
N = 5
CH_D = 6.6           # fits USB-C / Lightning cables up to 6 mm
SLOT_W = 4.2         # snap opening, cable squeezes in
CH_Z = 14.0
PITCH = 19.0


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def make_body():
    # soft "pebble" profile extruded along X, then rounded ends
    prof = (cq.Workplane("YZ").moveTo(-D / 2, 0).lineTo(D / 2, 0).lineTo(D / 2, H - 8)
            .threePointArc((0, H), (-D / 2, H - 8)).close())
    b = prof.extrude(L).translate((-L / 2, 0, 0))
    try:
        b = b.edges("|Y or |Z").fillet(7.0)
    except Exception:
        pass
    for i in range(N):
        x = (i - (N - 1) / 2) * PITCH
        ch = cq.Workplane("XZ").center(x, CH_Z).circle(CH_D / 2).extrude(-D - 2).translate((0, -D / 2 - 1, 0))
        sl = box(x - SLOT_W / 2, x + SLOT_W / 2, -D / 2 - 1, D / 2 + 1, CH_Z, H + 2)
        b = b.cut(ch).cut(sl)
    # pocket underneath for a steel weight (3/8 in SAE washers, 4 stacks) + VHB pad recess
    b = b.cut(box(-42, 42, -11.5, 11.5, 0, 7))
    b = b.cut(box(-50, 50, -14, 14, 0, 0.6))
    try:
        b = b.faces(">Z").edges().fillet(0.8)
    except Exception:
        pass
    return b


def make_weights():
    out = None
    for x in (-31, -10.5, 10.5, 31):
        w = (cq.Workplane("XY").circle(10.3).circle(5.0).extrude(6.4).translate((x, 0, 0.3)))
        out = w if out is None else out.union(w)
    return out


def make_cables():
    out = None
    for i in range(N):
        x = (i - (N - 1) / 2) * PITCH
        c = cq.Workplane("XZ").center(x, CH_Z).circle(2.0).extrude(-90).translate((0, -45, 0))
        head = cq.Workplane("XY").box(8.5, 22, 4.5).edges("|Y").fillet(1.8).translate((x, -D / 2 - 11, CH_Z))
        out = c.union(head) if out is None else out.union(c).union(head)
    return out


def parts():
    return [
        {"name": "Cable dock body", "shape": make_body(), "group": "case", "color": "#4dd0c8", "explode": [0, 0, 1]},
        {"name": "3/8 in SAE steel washers (weight)", "shape": make_weights(), "group": "component",
         "color": "#9aa0a6", "explode": [0, 0, -1]},
        {"name": "Charging cables (not included)", "shape": make_cables(), "group": "component",
         "color": "#f2f2f2", "explode": [0, -1, 0]},
    ]
