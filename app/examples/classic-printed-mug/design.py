import cadquery as cq

# Classic ~350 ml mug, printed in one piece (PETG), handle on +X
OD = 84.0       # outer diameter
H = 96.0        # height
WALL = 3.0
FLOOR = 5.0
R = OD / 2

# handle (D-loop in the XZ plane)
H_W = 14.0      # handle width (Y)
H_T = 9.0       # handle bar thickness
H_REACH = 30.0  # how far it sticks out from the wall
H_Z0, H_Z1 = 18.0, 80.0


def body():
    outer = cq.Workplane("XY").circle(R).extrude(H)
    try:
        outer = outer.faces("<Z").edges().fillet(6).faces(">Z").edges().fillet(1.2)
    except Exception:
        pass
    inner = (cq.Workplane("XY").workplane(offset=FLOOR)
             .circle(R - WALL).extrude(H))
    try:
        inner = inner.faces("<Z").edges().fillet(8)
    except Exception:
        pass
    return outer.cut(inner)


def handle():
    zc = (H_Z0 + H_Z1) / 2
    hz = (H_Z1 - H_Z0) / 2
    x0 = R - 6  # start inside the wall so it fuses
    outer = (cq.Workplane("XZ").center(x0 + H_REACH / 2, zc)
             .rect(H_REACH + 12, hz * 2).extrude(H_W / 2, both=True))
    try:
        outer = outer.edges("|Y").fillet(14).edges().fillet(3.5)
    except Exception:
        pass
    hole = (cq.Workplane("XZ").center(x0 + (H_REACH + 6) / 2, zc)
            .rect(H_REACH + 6 - 2 * H_T + 6, hz * 2 - 2 * H_T)
            .extrude(H_W, both=True))
    try:
        hole = hole.edges("|Y").fillet(9)
    except Exception:
        pass
    h = outer.cut(hole)
    # trim anything that pokes into the cup cavity
    cavity = (cq.Workplane("XY").workplane(offset=FLOOR)
              .circle(R - WALL).extrude(H))
    return h.cut(cavity)


def parts():
    mug = body().union(handle())
    return [{"name": "Mug", "shape": mug, "group": "case",
             "process": "print", "color": "#e8e2d6"}]
